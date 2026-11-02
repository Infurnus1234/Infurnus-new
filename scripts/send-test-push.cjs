#!/usr/bin/env node
/**
 * CLI tool to send a test push notification to a device via the backend API or directly.
 * Usage:
 *   node scripts/send-test-push.cjs <USER_ID> [driver|customer] [API_URL] [ADMIN_TOKEN]
 *
 * Example:
 *   node scripts/send-test-push.cjs 12345678-1234-1234-1234-123456789abc driver http://localhost:3000 my-admin-jwt
 */

const targetUserId = process.argv[2];
const audience = process.argv[3] || 'driver';
const apiUrl = process.argv[4] || process.env.API_URL || 'http://localhost:3000';
const adminToken = process.argv[5] || process.env.ADMIN_TOKEN;

if (!targetUserId) {
  console.log(`
Usage:
  node scripts/send-test-push.cjs <USER_ID> [driver|customer] [API_URL] [ADMIN_TOKEN]

Parameters:
  USER_ID      Target user UUID (whose device registered the FCM token)
  audience     "driver" (channel: infurnus_driver_channel_v2) or "customer" (channel: infurnus_ride_updates_v2)
  API_URL      Backend URL (default: http://localhost:3000)
  ADMIN_TOKEN  Bearer JWT token with role 'admin' or 'super_admin'

Curl equivalent:
  curl -X POST "${apiUrl}/notifications/test-push" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer <ADMIN_TOKEN>" \\
    -d '{
      "userId": "${targetUserId || '<USER_ID>'}",
      "audience": "${audience}",
      "title": "Test Alert",
      "body": "Checking custom notification sound"
    }'
`);
  process.exit(1);
}

if (!adminToken) {
  console.log(`
No ADMIN_TOKEN provided. Use the curl command below with your admin JWT:

curl -X POST "${apiUrl}/notifications/test-push" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_ADMIN_JWT>" \\
  -d '{
    "userId": "${targetUserId}",
    "audience": "${audience}",
    "title": "🔔 Infurnus sound test",
    "body": "Testing custom sound infurnus_alert"
  }'
`);
  process.exit(0);
}

async function run() {
  console.log(`Sending test push to user ${targetUserId} (${audience})...`);
  try {
    const response = await fetch(`${apiUrl}/notifications/test-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: targetUserId,
        audience,
        title: `🔔 Test notification (${audience})`,
        body: 'If you hear the custom sound, everything is configured correctly!',
      }),
    });

    const result = await response.json();
    console.log('Response status:', response.status);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

run();
