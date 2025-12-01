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
5. Click "Deploy"

### Step 3: Test Your API
After deployment, your API will be at:
- `https://your-project-name.vercel.app/api/upload`
- `https://your-project-name.vercel.app/api/lookup`
- `https://your-project-name.vercel.app/api/stats`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | Your MongoDB Atlas connection string |
| `UPLOAD_PASSWORD` | Password required to upload data |
