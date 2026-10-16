-- @param bookingId NUMERIC
SELECT b.booking_id, b.status, b.check_in, b.check_out,
       b.guests_count, b.total_amount,
       u.name AS guest_name, u.email AS guest_email,
       p.title AS property_title, d.destination
FROM samples.wanderbricks.bookings b
JOIN samples.wanderbricks.users u ON b.user_id = u.user_id
JOIN samples.wanderbricks.properties p ON b.property_id = p.property_id
JOIN samples.wanderbricks.destinations d ON p.destination_id = d.destination_id
WHERE b.booking_id = :bookingId
