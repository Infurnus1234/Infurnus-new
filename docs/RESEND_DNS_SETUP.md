# Resend sending-domain setup

The user explicitly approved registering `infurnuslogistics.com` on 18 October 2026. The domain entry was created in the existing Resend account. It is not yet verified; no DNS records have been published by this task.

Dashboard: https://resend.com/domains/add/096023aa-54e0-4cd7-bfba-1233c5b4d60d

The following values were read from this domain's actual Resend manual-setup page. Use these account-specific records rather than generic examples. TTL is Auto.

| Type  | Name/host           | Value/target                                                                                                                                                                                                                 |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDMQ9PM6IsMcHLWQFkkwKqs+ffRzBS8uJ3Eww9NZdxLVdYJ/Upm33vDghgjH+2AQhiLClcieqgcyYBczAP7Jg2jfaF1pKqoeoLB95vFqvferQJFHIS60lWDTRLVz1uPYV9hHlBOZKp0q0OFSPH+hjzQfZpwI4c5MEJiwc28DUlWqQIDAQAB` |
| CNAME | `rsend`             | `rsend-apne1.forge.rmta.net`                                                                                                                                                                                                 |
| CNAME | `send`              | `send.forge.rmta.net`                                                                                                                                                                                                        |

The TXT value is a public DKIM verification key, not an API secret. The Resend setup page identifies GoDaddy as the DNS host and the selected region as Tokyo.

Publish only these records after the DNS change is authorized. Preserve existing root-domain MX records, website records, and unrelated DNS. Do not enable receiving or delegate unrestricted DNS access just to send OTP email.

After the records resolve and Resend confirms verification, configure the local backend's RESEND_FROM_EMAIL to an address on this domain, then retry a controlled OTP send to the previously authorized test address. Keep the existing API key in the local environment/secret store. Do not claim delivery or change the runtime sender to an unverified domain before verification succeeds.

Latest provider/security regression run: 27 passed, zero failed; `tmp/auth-completion/resend-dashboard-provider-tests.log`.
