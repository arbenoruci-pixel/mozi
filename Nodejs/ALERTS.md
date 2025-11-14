# Auto-Alert System & Trial Mode Documentation

## Overview
Your crypto signal server includes an automatic alert system with a built-in **5-day free trial** for all new Telegram users. The system monitors all 12 supported cryptocurrencies every 10 minutes and broadcasts alerts to active subscribers when signals change.

## 🆓 Free Trial System

### How Trial Mode Works

**New User Flow:**
1. User finds **@arben_crypto_bot** on Telegram
2. Sends `/start` command
3. Automatically receives 5-day trial access
4. Gets welcome message with expiry date
5. Starts receiving live BUY/SELL alerts immediately

**Trial Features:**
- **Duration**: 5 days (configurable)
- **Plan Type**: "trial"
- **Access**: Full alerts for all 12 cryptocurrencies
- **Expiry Notification**: Automatic one-time message when trial ends

### Bot Commands

**`/start [referral_code]`**
- Registers new users with instant trial activation
- Existing users receive welcome back message
- Optional referral code tracking for partner programs

**`/status`**
- Shows current subscription plan (trial/basic/premium)
- Displays expiry date and days remaining
- Indicates if trial is active or expired

### Trial Expiry Flow

When a trial expires:
1. User automatically stops receiving alerts
2. One-time expiry notification sent via Telegram
3. Message includes instructions to contact support
4. User flagged as `trial_notified: true` (prevents repeat messages)

## How Alert Broadcasting Works

### Signal Monitoring
- **Frequency**: Checks all 12 cryptocurrencies every 10 minutes
- **Alert Trigger**: Only sends when signal changes from HOLD → BUY or HOLD → SELL
- **Recipient Filtering**: Broadcasts only to active (non-expired) users
- **Memory Storage**: Tracks last known signal for each coin to detect changes

### Broadcast System

**Multi-User Broadcasting:**
- System loads all users from `users.json`
- Filters by `expires_at > current_time` (active users only)
- Sends alerts to each active user's `chat_id`
- 100ms delay between messages to avoid rate limits
- Logs success/failure for each recipient

**Message Format:**
```
🚨 CRYPTO ALERT - BTC

Signal: BUY
Price: $106,653
RSI: 61.74
Time: 11/11/2025, 6:44:00 AM
```

## Admin Setup

### 1. Create Telegram Bot

**Via BotFather:**
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Choose a name: "Arben Crypto Signals"
4. Choose username: `@arben_crypto_bot` (or similar)
5. Save the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Configure Replit Secrets

Add in Replit Tools → Secrets:
- **`TELEGRAM_BOT_TOKEN`** = your bot token from BotFather
- **`ADMIN_SECRET`** = strong random token for admin API authentication (required)
- **`TELEGRAM_CHAT_ID`** = (Optional) your personal chat ID for testing
- **`TRIAL_DAYS`** = (Optional) Override default 5-day trial

**Security:**
- Generate ADMIN_SECRET with: `openssl rand -base64 32` or similar
- Keep ADMIN_SECRET private - it grants full user management access
- Admin endpoints disabled if ADMIN_SECRET not set

**Note:** When bot is initialized, it uses polling mode (works on Replit without webhooks).

## API Endpoints

### User Management (Admin - Protected)

**🔒 Authentication Required**: All admin endpoints require `ADMIN_SECRET` in Authorization header.

**Get All Users:**
```bash
GET /api/users
Authorization: Bearer your-admin-secret-here
```
Returns all registered users with their subscription details.

**Get Active Users Only:**
```bash
GET /api/users?active=1
Authorization: Bearer your-admin-secret-here
```
Filters to show only users with valid (non-expired) subscriptions.

**Response Example:**
```json
{
  "ok": true,
  "count": 15,
  "users": [
    {
      "chat_id": 123456789,
      "username": "john_crypto",
      "first_name": "John",
      "plan": "trial",
      "created_at": "2025-11-11T10:00:00.000Z",
      "expires_at": "2025-11-16T10:00:00.000Z",
      "trial_notified": false
    }
  ]
}
```

**Activate/Upgrade User:**
```bash
POST /api/user/activate
Authorization: Bearer your-admin-secret-here
Content-Type: application/json

{
  "chat_id": 123456789,
  "plan": "basic",
  "days": 30
}
```

Converts trial users to paid plans or extends existing subscriptions.

**Security Notes:**
- ADMIN_SECRET must be set as environment variable
- Without ADMIN_SECRET, endpoints return `503 Service Unavailable`
- Invalid/missing token returns `401 Unauthorized`
- Referral data excluded from API responses for privacy

**Response:**
```json
{
  "ok": true,
  "message": "User activated successfully",
  "user": {
    "chat_id": 123456789,
    "plan": "basic",
    "expires_at": "2025-12-11T10:00:00.000Z"
  }
}
```

**Note:** User automatically receives Telegram notification about activation.

### Alert System

**Check Alert Status:**
```
GET /api/alerts/status
```
Returns current alert system status, monitored symbols, and last known signals.

**Manual Signal Check:**
```
POST /api/alerts/check-now
```
Triggers immediate signal check for all coins (useful for testing).

## Alert Message Format
```
🚨 CRYPTO ALERT - BTC

Signal: BUY
Price: $106,653
RSI: 61.74
Time: 11/11/2025, 6:44:00 AM
```

## User Data Management

### Storage
User data is stored in `users.json` with this structure:
```json
{
  "chat_id": 123456789,
  "username": "trader_pro",
  "first_name": "Alex",
  "plan": "trial",
  "referred_by": null,
  "created_at": "2025-11-11T10:00:00.000Z",
  "expires_at": "2025-11-16T10:00:00.000Z",
  "trial_notified": false
}
```

### Adding/Removing Coins

To monitor additional cryptocurrencies:
1. Edit `SUPPORTED_SYMBOLS` array in `index.js`
2. Add corresponding ticker to `SYMBOLS` mapping
3. Restart server

Example:
```javascript
const SUPPORTED_SYMBOLS = ['btc', 'eth', 'sol', 'atom']; // Added ATOM
const SYMBOLS = {
  btc: 'BTC',
  eth: 'ETH', 
  sol: 'SOL',
  atom: 'ATOM' // Add mapping
};
```

Everything else (dashboard, alerts, endpoints) updates automatically!

### Changing Trial Length

**Option 1:** Environment Variable (recommended)
```
TRIAL_DAYS=7
```

**Option 2:** Edit `index.js`
```javascript
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS) || 5; // Change default
```

## Troubleshooting

**Bot not responding to /start?**
- Verify `TELEGRAM_BOT_TOKEN` is set correctly in Replit Secrets
- Check server console for "🤖 Telegram bot initialized with polling"
- Look for polling errors in console logs
- Restart the workflow after adding secrets

**Alerts not sending to users?**
- Check `/api/users?active=1` to see active user count
- Verify users have `expires_at > current_time`
- Check console for "Alert broadcast to X/Y active users"
- Look for Telegram API errors in logs

**Trial not starting?**
- Ensure `users.json` file exists and is writable
- Check console for `[Trial] Started 5-day trial for chat_id=...`
- Verify user record was created with `/api/users`

**Expiry notification not sent?**
- Check `trial_notified` field in user record
- Notification only sent once per user
- Triggered during signal check cycle (every 10 minutes)

## Testing Workflow

1. **Test Bot Registration:**
   ```bash
   # Send /start to @arben_crypto_bot
   # Check console for trial creation log
   curl http://localhost:5000/api/users | jq
   ```

2. **Test User Status:**
   ```bash
   # Send /status to bot
   # Verify expiry date is 5 days from now
   ```

3. **Test Manual Activation:**
   ```bash
   curl -X POST http://localhost:5000/api/user/activate \
     -H "Authorization: Bearer your-admin-secret" \
     -H "Content-Type: application/json" \
     -d '{"chat_id": 123456789, "plan": "basic", "days": 30}'
   ```

4. **Test Alert Broadcast:**
   ```bash
   curl -X POST http://localhost:5000/api/alerts/check-now
   # Check console for broadcast count
   ```

5. **Monitor Alert System:**
   ```bash
   curl http://localhost:5000/api/alerts/status | jq
   ```
