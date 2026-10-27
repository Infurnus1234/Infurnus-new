-- Registration metadata only; no pricing, eligibility or dispatch activation.
-- Retain metadata if an administrator removes a fare configuration; catalog()
-- always prefers the existing canonical record and never returns duplicate pairs.
CREATE TABLE fleet_registration_vehicle_types (
 sector VARCHAR(30) NOT NULL, code VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL,
 PRIMARY KEY(sector,code)
);
INSERT INTO fleet_registration_vehicle_types(sector,code,name) SELECT source.sector,source.code,source.name FROM (VALUES
('passenger','bike','Bike'),
('passenger','auto','Auto'),
('passenger','e-rickshaw','E-Rickshaw'),
('passenger','hatchback','Hatchback'),
('passenger','sedan','Sedan'),
('passenger','innova','Innova Crysta'),
('passenger','winger','Winger'),
('passenger','traveller','Force Traveller'),
('logistics','piaggio_ape','Piaggio Ape'),
('logistics','tata_magic','Tata Magic'),
('logistics','cargo_207','Pickup 207'),
('logistics','cargo_407','407 Cargo'),
('service','ambulance','Ambulance'),
('service','towing','Towing Van'),
('service','jcb','JCB Excavator'),
('service','road_roller','Road Roller'),
('service','crane','Crane'),
('service','fire_truck','Fire Truck'),
('service','roadside_assist','Roadside Assist'),
('premium','scorpio','Scorpio N'),
('premium','thar','Mahindra Thar'),
('premium','innova','Innova Crysta'),
('premium','traveller','Force Traveller'),
('premium','mercedes','Mercedes V-Class'),
('premium','helicopter','Helicopter'),
('rental','innova','Innova Crysta'),
('rental','fortuner','Toyota Fortuner'),
('rental','traveller','Force Traveller'),
('rental','thar','Off-road SUV (Thar)'),
('rental','scorpio_n','Scorpio N'),
('rental','helicopter','Helicopter'),
('rental','charter_flight','Charter Flight'),
('rental','yacht','Yacht'),
('logistics','three_wheeler','Piaggio Ape'),
('logistics','mini_truck','Mini Truck'),
('logistics','cargo_207_heavy','207 Heavy'),
('logistics','tata_407','407 Cargo'),
('logistics','e_rickshaw','E-Rickshaw Cargo'),
('passenger','suv','SUV'),
('passenger','mini_commercial','Mini Commercial'),
('logistics','mini_commercial','Mini / Commercial'),
('logistics','electric_tuk_tuk','Electric Tuk-Tuk')
) AS source(sector,code,name)
ON CONFLICT(sector,code) DO NOTHING;
