# Invitation Email Setup

## Prerequisites

Before the invitation emails will work, you need to verify your sender email address with AWS SES.

### 1. Verify Email Address in SES

In your terminal, run:

```powershell
aws ses verify-email-identity --email-address noreply@yourdomain.com --region us-east-1
```

Replace `noreply@yourdomain.com` with your actual email address.

Check your inbox for a verification email from AWS and click the verification link.

### 2. Update Configuration

Update the `FROM_EMAIL` in [amplify/functions/send-invitation-email/resource.ts](amplify/functions/send-invitation-email/resource.ts):

```typescript
FROM_EMAIL: 'your-verified-email@yourdomain.com'
```

### 3. Production Setup (Optional)

For production with a custom domain:

1. **Request Production Access**: By default, SES is in sandbox mode (can only send to verified addresses)
   - Go to AWS SES Console → Account Dashboard → Request production access

2. **Verify Domain**: Instead of individual emails, verify your entire domain
   ```powershell
   aws ses verify-domain-identity --domain yourdomain.com --region us-east-1
   ```

3. **Add DNS Records**: Follow AWS instructions to add DKIM and verification TXT records

### 4. Testing

After verification, test by:
1. Creating a season/team
2. Sending an invitation from the Sharing tab
3. Check the invitee's email inbox

### Email Template

The Lambda sends a styled HTML email with:
- Gradient header (purple)
- Role badge
- Accept button linking to the app
- Expiration date
- Plain text fallback

### Monitoring

Check Lambda logs:
```powershell
aws logs tail /aws/lambda/send-invitation-email --follow
```

### Cost

- SES: $0.10 per 1,000 emails
- Lambda: Included in free tier for typical usage
- DynamoDB Streams: Included in free tier

### Troubleshooting

**Emails not sending?**
- Check email is verified: `aws ses list-verified-email-addresses`
- Check Lambda logs for errors
- Verify DynamoDB streams are enabled on invitation tables

**Emails go to spam?**
- Add SPF, DKIM records (domain verification)
- Request production access to remove "via amazonses.com"
