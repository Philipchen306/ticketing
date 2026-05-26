import asyncio
import httpx
import time
import statistics
from collections import Counter

BASE_URL = "http://localhost:3000"
EVENT_ID = 3

TOTAL_USERS = 250
ADMIT_LIMIT = 10

# Options:
# "normal"        -> different users, different IPs, different devices
# "same_ip"       -> different users, same IP
# "same_user"     -> same userId, different IPs/devices
# "invalid_token" -> users skip queue/admit and directly attack /book
# "mixed" -> real users + bot
MODE = "mixed"


def make_user_id(user_num):
    if MODE in ["same_user"]:
        return "bot-user"
    return f"user-{user_num}"


def make_headers(user_num):
    if MODE == "normal":
        ip = f"10.0.0.{user_num % 255}"
        device_id = f"device-{user_num}"

    elif MODE == "same_ip":
        ip = "10.0.0.1"
        device_id = f"device-{user_num}"

    elif MODE == "same_user":
        ip = f"10.0.0.{user_num % 255}"
        device_id = f"device-{user_num}"

    elif MODE == "invalid_token":
        ip = f"10.0.0.{user_num % 255}"
        device_id = f"device-{user_num}"

    else:
        ip = f"10.0.0.{user_num % 255}"
        device_id = f"device-{user_num}"

    return {
        "x-forwarded-for": ip,
        "x-device-id": device_id,
        "user-agent": "load-test-client"
    }


def safe_json(response):
    try:
        return response.json()
    except Exception:
        return response.text


async def join_queue(client, user_num):
    user_id = make_user_id(user_num)

    return await client.post(
        f"{BASE_URL}/events/{EVENT_ID}/queue/join",
        json={"userId": user_id},
        headers=make_headers(user_num)
    )


async def admit_users(client):
    return await client.post(
        f"{BASE_URL}/events/{EVENT_ID}/queue/admit",
        json={"limit": ADMIT_LIMIT}
    )


async def reserve_ticket(client, user_id, user_num, token):
    return await client.post(
        f"{BASE_URL}/events/{EVENT_ID}/book",
        json={
            "userId": user_id,
            "bookingToken": token
        },
        headers=make_headers(user_num)
    )


async def confirm_booking(client, user_id, user_num, ticket_id):
    return await client.post(
        f"{BASE_URL}/events/{EVENT_ID}/booking/confirm",
        json={
            "userId": user_id,
            "ticketId": ticket_id
        },
        headers=make_headers(user_num)
    )


async def invalid_token_attack(client, user_num):
    user_id = make_user_id(user_num)
    start = time.time()

    response = await client.post(
        f"{BASE_URL}/events/{EVENT_ID}/book",
        json={
            "userId": user_id,
            "bookingToken": "fake-token"
        },
        headers=make_headers(user_num)
    )

    latency = time.time() - start

    return {
        "userId": user_id,
        "status": response.status_code,
        "step": "invalid_token_attack",
        "body": safe_json(response),
        "latency": latency
    }


async def reserve_and_confirm(client, user_id, user_num, token):
    start = time.time()

    try:
        reserve_response = await reserve_ticket(client, user_id, user_num, token)
        reserve_latency = time.time() - start

        if reserve_response.status_code != 200:
            return {
                "userId": user_id,
                "status": reserve_response.status_code,
                "step": "reserve",
                "body": safe_json(reserve_response),
                "latency": reserve_latency
            }

        ticket_id = reserve_response.json()["ticketId"]

        confirm_response = await confirm_booking(client, user_id, user_num, ticket_id)
        total_latency = time.time() - start

        return {
            "userId": user_id,
            "status": confirm_response.status_code,
            "step": "confirm",
            "body": safe_json(confirm_response),
            "latency": total_latency
        }

    except Exception as e:
        return {
            "userId": user_id,
            "status": "error",
            "step": "exception",
            "body": str(e),
            "latency": None
        }


async def run_invalid_token_test():
    start_all = time.time()

    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [invalid_token_attack(client, i) for i in range(TOTAL_USERS)]
        results = await asyncio.gather(*tasks)

    print_summary(results, time.time() - start_all)


async def run_queue_booking_test():
    start_all = time.time()
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        join_tasks = [join_queue(client, i) for i in range(TOTAL_USERS)]
        join_responses = await asyncio.gather(*join_tasks)

        joined = sum(1 for r in join_responses if r.status_code == 200)
        join_failed = [r for r in join_responses if r.status_code != 200]

        print("Mode:", MODE)
        print("Joined queue:", joined)
        print("Join failed:", len(join_failed))

        while True:
            admit_response = await admit_users(client)

            if admit_response.status_code == 404:
                break

            if admit_response.status_code != 200:
                print("Admit failed:", admit_response.status_code, admit_response.text)
                break

            admitted_users = admit_response.json().get("admittedUsers", [])

            if not admitted_users:
                break

            batch_tasks = []

            for user in admitted_users:
                user_id = user["userId"]
                token = user["bookingToken"]

                if user_id == "bot-user":
                    user_num = 0
                else:
                    try:
                        user_num = int(user_id.split("-")[1])
                    except Exception:
                        user_num = 0

                batch_tasks.append(
                    reserve_and_confirm(client, user_id, user_num, token)
                )

            batch_results = await asyncio.gather(*batch_tasks)
            results.extend(batch_results)

            await asyncio.sleep(0.2)

    print_summary(results, time.time() - start_all)

async def run_mixed_test():
    start_all = time.time()
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        # 20 bots, each sends 10 join requests = 200 bot requests
        bot_tasks = []

        for bot_num in range(20):
            user_id = f"bot-{bot_num}"
            headers = {
                "x-forwarded-for": f"10.1.0.{bot_num}",
                "x-device-id": f"bot-device-{bot_num}",
                "user-agent": "bot-client"
            }

            for _ in range(10):
                bot_tasks.append(
                    client.post(
                        f"{BASE_URL}/events/{EVENT_ID}/queue/join",
                        json={"userId": user_id},
                        headers=headers
                    )
                )

        # 100 real users join at the same time
        real_tasks = [join_queue(client, i) for i in range(100)]

        all_join = await asyncio.gather(*bot_tasks, *real_tasks)

        bot_responses = all_join[:len(bot_tasks)]
        real_responses = all_join[len(bot_tasks):]

        bot_status = Counter(r.status_code for r in bot_responses)
        real_status = Counter(r.status_code for r in real_responses)

        print("Mode:", MODE)
        print("Bot requests:", len(bot_responses), "status:", dict(bot_status))
        print("Real users:", len(real_responses), "status:", dict(real_status))

        while True:
            admit_response = await admit_users(client)

            if admit_response.status_code == 404:
                break

            if admit_response.status_code != 200:
                print("Admit failed:", admit_response.status_code, admit_response.text)
                break

            admitted_users = admit_response.json().get("admittedUsers", [])

            if not admitted_users:
                break

            batch_tasks = []

            for user in admitted_users:
                user_id = user["userId"]
                token = user["bookingToken"]

                if user_id.startswith("user-"):
                    try:
                        user_num = int(user_id.split("-")[1])
                    except Exception:
                        user_num = 0
                else:
                    # bot users use bot-like headers
                    user_num = 0

                batch_tasks.append(
                    reserve_and_confirm(client, user_id, user_num, token)
                )

            batch_results = await asyncio.gather(*batch_tasks)
            results.extend(batch_results)

            await asyncio.sleep(0.2)

    print_summary(results, time.time() - start_all)

def print_summary(results, total_time):
    success = [r for r in results if r["status"] == 200]
    failed = [r for r in results if r["status"] != 200]
    latencies = [r["latency"] for r in results if r["latency"] is not None]

    status_counter = Counter(r["status"] for r in results)
    step_counter = Counter(r["step"] for r in failed)

    print("\n=== Load Test Result ===")
    print("Mode:", MODE)
    print("Total users:", TOTAL_USERS)
    print("Processed users:", len(results))
    print("Success:", len(success))
    print("Failed:", len(failed))
    print("Status breakdown:", dict(status_counter))
    print("Failed step breakdown:", dict(step_counter))
    print("Total time:", round(total_time, 3), "sec")

    if latencies:
        print("Avg latency:", round(statistics.mean(latencies), 3), "sec")

        if len(latencies) >= 20:
            print("P95 latency:", round(statistics.quantiles(latencies, n=20)[18], 3), "sec")

    print("\nSample failed responses:")
    for r in failed[:5]:
        print(r)


async def main():
    if MODE == "invalid_token":
        await run_invalid_token_test()
    elif MODE == "mixed":
        await run_mixed_test()
    else:
        await run_queue_booking_test()


asyncio.run(main())