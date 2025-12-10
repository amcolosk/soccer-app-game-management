# Bug Report System

## How It Works

Users can report bugs directly from the app by clicking the "🐛 Report Issue" button in the footer.

### What Gets Collected

Each bug report includes:
- **Description**: What went wrong
- **Steps to Reproduce**: How to recreate the issue (optional)
- **Severity**: Low, Medium, or High
- **System Information**: Automatically collected
  - User agent (browser/device info)
  - Screen size and viewport
  - Current URL
  - App version
  - Timestamp

### How Reports Are Stored

Bug reports are stored in your DynamoDB database as `GameNote` records with:
- `gameId`: "BUG_REPORT" (special marker)
- `note`: JSON string containing all bug report data
- `timestamp`: When the report was submitted

## Viewing Bug Reports

### Option 1: AWS Console (Recommended)

1. Go to AWS Console → DynamoDB
2. Select your GameNote table
3. Click "Explore items"
4. Filter by: `gameId = "BUG_REPORT"`
5. View the `note` field which contains the JSON data

### Option 2: Create Admin Panel (Future Enhancement)

You could create an admin route in your app:

```typescript
// Example admin component to view bug reports
const BugReportAdmin = () => {
  const [reports, setReports] = useState([]);
  
  useEffect(() => {
    const loadReports = async () => {
      const result = await client.models.GameNote.list({
        filter: { gameId: { eq: 'BUG_REPORT' } }
      });
      setReports(result.data);
    };
    loadReports();
  }, []);
  
  return (
    <div>
      {reports.map(report => {
        const data = JSON.parse(report.note);
        return (
          <div key={report.id}>
            <h3>{data.severity} - {data.timestamp}</h3>
            <p>{data.description}</p>
            <pre>{JSON.stringify(data.systemInfo, null, 2)}</pre>
          </div>
        );
      })}
    </div>
  );
};
```

### Option 3: AWS CLI

Query bug reports via command line:

```bash
aws dynamodb scan \
  --table-name [YourGameNoteTableName] \
  --filter-expression "gameId = :gameId" \
  --expression-attribute-values '{":gameId":{"S":"BUG_REPORT"}}'
```

### Option 4: Email Notifications (Advanced)

Set up AWS Lambda + SNS to email you when bug reports are submitted:

1. Create Lambda function triggered by DynamoDB stream
2. Check if new item has `gameId = "BUG_REPORT"`
3. Send email via SNS with bug report details

## Parsing Bug Report Data

Bug reports are stored as JSON in the `note` field:

```json
{
  "type": "BUG_REPORT",
  "description": "Game timer stopped working",
  "steps": "1. Started game\n2. Clicked pause\n3. Timer froze",
  "severity": "high",
  "systemInfo": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0...)",
    "screenSize": "390x844",
    "viewport": "390x844",
    "timestamp": "2025-12-09T19:45:00.000Z",
    "url": "https://yourapp.com/",
    "version": "1.0.0"
  }
}
```

## Future Enhancements

### 1. Dedicated Bug Report Model

Instead of using `GameNote`, create a dedicated model in `amplify/data/resource.ts`:

```typescript
BugReport: a
  .model({
    description: a.string().required(),
    steps: a.string(),
    severity: a.enum(['low', 'medium', 'high']),
    userAgent: a.string(),
    screenSize: a.string(),
    viewport: a.string(),
    appVersion: a.string(),
    url: a.string(),
    status: a.enum(['new', 'investigating', 'fixed', 'wont-fix']),
    notes: a.string(),
    owner: a.string().authorization((allow) => [allow.owner().to(['read'])]),
  })
  .authorization((allow) => [allow.owner()]),
```

### 2. Screenshot Capture

Add ability to capture screenshots:

```typescript
// In BugReport component
const captureScreenshot = async () => {
  const canvas = await html2canvas(document.body);
  const screenshot = canvas.toDataURL('image/png');
  // Upload to S3 or include in report
};
```

### 3. Automatic Email Notifications

Configure AWS SES to send you emails when bugs are reported.

### 4. Admin Dashboard

Create a protected admin route to view/manage bug reports with:
- List view with filters (severity, date, status)
- Detail view with all information
- Status updates (new → investigating → fixed)
- Notes/comments on reports

## Privacy Considerations

The system collects:
- ✅ Device/browser information (anonymous)
- ✅ Screen dimensions
- ✅ App version
- ✅ Current URL
- ❌ NO personal information
- ❌ NO user credentials
- ❌ NO location data

User's email is associated via Cognito owner field but not explicitly collected in the report.
