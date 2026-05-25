-- @param limit NUMERIC
SELECT d.destination, d.country,
       COUNT(DISTINCT b.booking_id) AS total_bookings,
       ROUND(SUM(b.total_amount), 2) AS total_revenue,
       ROUND(AVG(r.rating), 1) AS avg_rating
FROM samples.wanderbricks.bookings b
JOIN samples.wanderbricks.properties p ON b.property_id = p.property_id
JOIN samples.wanderbricks.destinations d ON p.destination_id = d.destination_id
LEFT JOIN samples.wanderbricks.reviews r ON b.booking_id = r.booking_id
GROUP BY d.destination, d.country
ORDER BY total_revenue DESC
LIMIT CAST(:limit AS INT)
