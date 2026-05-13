create table if not exists events (
    id int auto_increment primary key,
    name varchar(255) not null,
    venue varchar(255) not null,
    event_time datetime not null,
    created_at timestamp default current_timestamp
);

create table if not exists tickets (
    id int auto_increment primary key,
    event_id int not null,
    status enum('available', 'reserved', 'sold') default 'available',
    user_id varchar(255),
    reserved_at timestamp null,
    created_at timestamp default current_timestamp, 
    foreign key (event_id) references events(id)
);