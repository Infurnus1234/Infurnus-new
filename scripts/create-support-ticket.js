import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://infurnus:infurnus_dev@localhost:5432/infurnus',
});

async function createTicket() {
  const userRes = await pool.query(
    "SELECT id FROM users WHERE email = 'user@infurnus.com' OR phone = '+919999999999' LIMIT 1",
  );
  const userId = userRes.rows[0]?.id || 'f96be580-a039-4342-8a02-fed3d823b994';

  const category = 'Technical Issue / App Development';
  const subject = 'Driver App UI Redesign, Vehicle Search & Smart Driver Matching Implementation';
  const message = `1. Customer and Driver App UI Consistency
Driver App should follow the same design as Customer App.
Use the same colors, background, theme, logo, icons, typography, buttons, and card styles.
Maintain a consistent user experience across both apps.

2. Vehicle Search and Selection
Add a search bar for vehicle selection.
Show dynamic suggestions while typing.
Example: Typing "Al" should show Alto, Alto K10, etc.
Suggestions must come from actual backend vehicle data.
Allow drivers to select their vehicle from the suggestions.
Avoid hardcoded vehicle lists.

3. Smart Driver Matching
Implement vehicle-category-based booking distribution.
Bike booking -> Bike drivers only.
Auto booking -> Auto drivers only.
Mini/Compact booking -> Compatible Mini/Compact car drivers.
Sedan booking -> Sedan drivers only.
SUV booking -> SUV drivers only.
Logistics booking -> Compatible goods vehicle drivers.
Ambulance booking -> Eligible Ambulance drivers.
Towing booking -> Eligible Towing Van drivers.
JCB booking -> Eligible JCB operators.
Premium booking -> Eligible Premium Vehicle drivers.

4. Driver Eligibility
Before sending a booking, verify:
- Driver is online and available.
- Driver profile and vehicle are approved.
- Vehicle category matches the booking.
- Driver is within the configured service radius.
- Driver does not have another active ride.
- Driver is eligible for the requested service sector.

5. Automatic Booking Distribution
Send booking requests only to eligible drivers.
If a driver rejects or does not respond within the configured time, try the next eligible driver.
Once accepted, prevent other drivers from accepting the same booking.
Avoid duplicate booking assignments.
Validate all matching rules on the backend.

6. Testing
Test all vehicle categories and booking types.
Verify that Bike bookings never reach Car drivers and Car bookings never reach Bike drivers.
Verify rejection, timeout, reassignment, and duplicate acceptance scenarios.`;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const ticketNumber = `TCK-${Date.now().toString().slice(-4)}${randomSuffix}`;

  const result = await pool.query(
    `
    INSERT INTO support_tickets (
      ticket_number, user_id, role, category, subject, message, status, created_at, updated_at
    )
    VALUES ($1, $2, 'driver', $3, $4, $5, 'OPEN', NOW(), NOW())
    RETURNING id, ticket_number, category, subject, status, created_at;
  `,
    [ticketNumber, userId, category, subject, message],
  );

  console.log('SUPPORT TICKET CREATED SUCCESSFULLY:');
  console.log(JSON.stringify(result.rows[0], null, 2));
  process.exit(0);
}

createTicket().catch((err) => {
  console.error('ERROR CREATING TICKET:', err);
  process.exit(1);
});
