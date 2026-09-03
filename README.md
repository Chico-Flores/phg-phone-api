# PHG Phone Lookup API

A serverless API for managing phone number lookups for the PHG call center.

## Endpoints

### POST /api/upload
Upload phone records to the database.

**Request Body:**
```json
{
  "password": "your-upload-password",
  "phoneRecords": [
    {
      "phone": "5106914093",
      "person": {
        "name": "JOHN DOE",
        "type": "PRIMARY",
        "address": "123 Main St",
        "city": "Los Angeles",
        "state": "CA",
        "zip": "90001",
        "county": "Los Angeles"
      }
    }
  ]
}
```

### GET /api/lookup?phone=5106914093
Look up a phone number.

### GET /api/stats
Get database statistics.

### POST /api/simplicity/file-search
Search Simplicity by account number (proxy for AutoSearch Chrome extension).

**Request Body:**
```json
{
  "fileNumber": "26-25163849"
}
```

**Query Parameter Alternative:**
```
GET /api/simplicity/file-search?fileNumber=26-25163849
```

**Optional Header:**
```
X-PHG-Extension-Key: <your-extension-gate-key>
```
(Only required if `EXTENSION_GATE_KEY` environment variable is set)

**Response (Success):**
```json
{
  "ok": true,
  "internalId": "2521694",
  "accountUrl": "https://app.simplicitycollect.com/MasterView.aspx?case_id=2521694",
  "accountNumber": "26-25163849",
  "debtorName": "John Doe"
}
```

**Response (Not Found):**
```json
{
  "ok": false,
  "error": "No debtor found for this file number"
}
```

**Note:** The proxy accepts `fileNumber` as the parameter name but searches Simplicity by `AccountNumber`. The `accountNumber` and `debtorName` fields in the response are optional and only included when available.

---

## Deployment to Vercel

### Step 1: Create GitHub Repository
1. Go to GitHub and create a new repository called `phg-phone-api`
2. Upload all these files to the repository

### Step 2: Deploy to Vercel
1. Go to vercel.com and log in
2. Click "Add New..." → "Project"
3. Import your `phg-phone-api` repository
4. Before deploying, add Environment Variables:
   - `MONGODB_URI` = `mongodb+srv://phg-uploader:YOUR_PASSWORD@phg-cluster.kajcdjc.mongodb.net/phoneLookups?retryWrites=true&w=majority`
   - `UPLOAD_PASSWORD` = `your-secure-password-here`
   - `SIMPLICITY_API_TOKEN` = `your-simplicity-api-token` (required for file search)
   - `EXTENSION_GATE_KEY` = `your-extension-key` (optional, for extension authentication)
5. Click "Deploy"

### Step 3: Test Your API
After deployment, your API will be at:
- `https://your-project-name.vercel.app/api/upload`
- `https://your-project-name.vercel.app/api/lookup`
- `https://your-project-name.vercel.app/api/stats`
- `https://your-project-name.vercel.app/api/simplicity/file-search`

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | Your MongoDB Atlas connection string | Yes |
| `UPLOAD_PASSWORD` | Password required to upload data | Yes |
| `SIMPLICITY_API_TOKEN` | Simplicity API token for file search | Yes (for file-search) |
| `EXTENSION_GATE_KEY` | Optional authentication key for Chrome extension | No |

**Note:** Set these environment variables in the Vercel project `phg-phone-api` under Settings → Environment Variables → Production.
