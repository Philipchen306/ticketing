import asyncio
import httpx 
import time 

URL = "http://localhost:3000/events/2/book"
TOTAL_USERS = 150

async def book_ticket(client, user_id):
    try:
        start = time.time()
        response = await client.post(URL, json={"userId": f"user-{user_id}"})
        latency = time.time() - start 

        return {
            "user_id": user_id,
            "status": response.status_code,
            "body": response.json(),
            "latency": latency
        }
    except Exception as e:
        return {
            "user_id": user_id,
            "status": "error",
            "body": str(e),
            "latency": None
        }

async def main():
    async with httpx.AsyncClient(timeout=10) as client: 
        tasks = [book_ticket(client, i) for i in range(TOTAL_USERS)]
        results = await asyncio.gather(*tasks)

    success = [r for r in results if r["status"] == 200]
    failed =  [r for r in results if r["status"] != 200]

    print("Total requests: ", len(results))
    print("Success: ", len(success))
    print("Failed: ", len(failed))

    if success:
        avg_latency = sum(r["latency"] for r in success) / len(success)
        print("Ave success latency: ", round(avg_latency, 3), "sec")

    print("\nSample failed responses:")
    for r in failed[:5]:
        print(r)

asyncio.run(main())