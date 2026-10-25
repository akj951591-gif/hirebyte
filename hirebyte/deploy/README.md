# Deploying the HireByte demo on AWS

One EC2 machine runs the whole app with Docker Compose. CloudFront sits in front of it and gives a
free `https://….cloudfront.net` address. HTTPS is required: browsers only allow the camera on
`https://` pages, and the session cookies are `Secure`.

```
Judges' browser ──HTTPS──▶ CloudFront ──HTTP:80──▶ EC2 (Ubuntu, Docker Compose)
                                                     ├─ web        nginx: built frontend + /api proxy
                                                     ├─ api        Node/Express API (port 4000, private)
                                                     ├─ documents  FastAPI resume extractor (private)
                                                     └─ postgres   PostgreSQL 18, data on the EBS disk (private)
Outside AWS (API keys only): Google Gemini (AI interviewer), LiveKit Cloud (live video).
```

Only port 80 is opened, and only to CloudFront. Postgres, the API and the document service are
reachable only inside Docker's private network.

**Total time:** about 45–60 minutes. **Region:** `ap-south-1` (Mumbai). If you and the judges are
not in India, pick the nearest region instead; every other step stays the same.

---

## Phase 1 — Before AWS (your laptop, 10 min)

### 1.1 Push the deployment files to GitHub

**Action:** The EC2 machine downloads the code from GitHub, so these files must be pushed first.
**Location:** Windows PowerShell.
**Commands:**
```powershell
cd D:\projects\hirebyte
git add hirebyte
git commit -m "Add AWS EC2 + CloudFront demo deployment"
git push
```
**Expected result:** `git push` ends with `feature/ai-conversation-camera-checks -> feature/ai-conversation-camera-checks`.
**If it fails:** `Permission denied` / `403` means your GitHub account cannot push to
`akj951591-gif/hirebyte`. Ask the repo owner to add you as a collaborator, or ask them to push.
`git status` must show no `.env` file. If it does, stop and tell your teammate before pushing.

### 1.2 Have these values ready (in Notepad, never in chat or on GitHub)

| Value | Where to get it |
| --- | --- |
| Gemini API key + model name | <https://aistudio.google.com/apikey> (free). Copy a current **Flash** model name from AI Studio's model list. |
| LiveKit URL, API key, API secret | LiveKit Cloud → your project → Settings → Keys. URL looks like `wss://<project>.livekit.cloud`. |
| Demo recruiter email + password | Choose them; the password must be at least 12 characters. |

Without Gemini, AI questions, interviewer replies and evaluation say "not configured". Without
LiveKit, live video and the phone camera are unavailable, but interviews still run.

---

## Phase 2 — AWS: the EC2 machine (15 min)

Sign in to the AWS Console and choose **Asia Pacific (Mumbai) ap-south-1** in the region menu
(top right). Stay in this region for every step.

### 2.1 Launch the instance

**Location:** EC2 → Instances → **Launch instances**.

| Setting | Value |
| --- | --- |
| Name | `hirebyte-demo` |
| AMI | **Ubuntu Server 24.04 LTS**, 64-bit (x86) |
| Instance type | **t3.medium** (2 vCPU, 4 GB). Smaller types run out of memory while building. |
| Key pair | Create new key pair → `hirebyte-key`, RSA, `.pem`. It is only a backup, because you will connect from the browser. |
| Network settings | Keep the default VPC and subnet, and leave **Auto-assign public IP** on. **Create security group**. Tick **Allow SSH traffic from Anywhere**. Do **not** tick the HTTP/HTTPS boxes. |
| Storage | **20 GiB gp3** (change it from 8) |

Click **Launch instance**.

**Expected result:** "Successfully initiated launch". After about 1 minute the instance shows
*Running* and *2/2 checks passed*.
**If it fails:** if t3.medium is not offered or you hit a vCPU limit, use **t3a.medium** (same size).
On a brand-new account, a "pending verification" message can take a few minutes to clear.

### 2.2 Give it a fixed address (Elastic IP)

**Why:** CloudFront points at the machine's DNS name. Without an Elastic IP, that name changes
whenever the instance is stopped and started.
**Location:** EC2 → Network & Security → **Elastic IPs** → **Allocate Elastic IP address** →
**Allocate**. Select the new address → **Actions → Associate Elastic IP address** → Instance:
`hirebyte-demo` → **Associate**.
**Expected result:** EC2 → Instances → `hirebyte-demo` → **Public IPv4 DNS** now looks like
`ec2-13-xxx-xxx-xxx.ap-south-1.compute.amazonaws.com`. Copy it. This is `<EC2_PUBLIC_DNS>`.

### 2.3 Let CloudFront (and only CloudFront) reach port 80

**Location:** EC2 → Instances → `hirebyte-demo` → **Security** tab → click the security group →
**Edit inbound rules** → **Add rule**.

| Type | Source |
| --- | --- |
| HTTP | Custom → type `cloudfront` in the box → pick **com.amazonaws.global.cloudfront.origin-facing** |

**Save rules.**
**Expected result:** two inbound rules: SSH (0.0.0.0/0) and HTTP (pl-…).
**If it fails:** if you see "rules per security group limit exceeded", set the HTTP source to
**Anywhere-IPv4**. Sign-in still only works over CloudFront's HTTPS, because the cookies are `Secure`.

### 2.4 Protect it from accidental deletion

**Location:** EC2 → Instances → select `hirebyte-demo` → **Actions → Instance settings → Change
termination protection** → **Enable** → Save.

---

## Phase 3 — AWS: CloudFront for HTTPS (5 min + 5–10 min deploying)

**Location:** CloudFront → Distributions → **Create distribution**.

| Setting | Value |
| --- | --- |
| Pricing plan (if asked) | **Pay as you go**. The flat-rate plans add WAF rules that can block file uploads and API calls. Demo traffic fits in CloudFront's always-free allowance. |
| Name / type | `hirebyte-demo`, **Single website or app**. No custom domain. |
| Origin type | **Other** (custom origin) |
| Origin domain | `<EC2_PUBLIC_DNS>` (the `ec2-…compute.amazonaws.com` name, not an IP) |
| Origin settings → Customize | Protocol **HTTP only**, HTTP port **80** |
| Cache settings → Customize | Viewer protocol policy **Redirect HTTP to HTTPS**. Allowed HTTP methods **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**. Cache policy **CachingDisabled**. Origin request policy **AllViewer**. |
| Security / WAF | **Do not enable security protections** |

Click **Create distribution**. Copy the **Distribution domain name** (`d1234abcd.cloudfront.net`).
This is `<CLOUDFRONT_DOMAIN>`. You need it in Phase 4, and you can carry on while it deploys.

**Then raise the timeout:** open the distribution → **Origins** tab → select the origin → **Edit** →
**Response timeout: 60** seconds → Save. This gives AI question generation time to finish.

**Expected result:** "Last modified" changes from *Deploying* to a date after 5–10 minutes.
**If it fails:** if your console shows the older form, the setting names are the same. Look for
"Origin domain", "Protocol", "Viewer protocol policy", "Cache key and origin requests", and "Web
Application Firewall".

---

## Phase 4 — Install and start the app (20–25 min, mostly waiting)

### 4.1 Open a terminal on the server

**Location:** EC2 → Instances → select `hirebyte-demo` → **Connect** → **EC2 Instance Connect** tab →
username `ubuntu` → **Connect**. A Linux terminal opens in your browser. All commands in Phase 4 go
here, not in PowerShell. To paste, press **Ctrl+Shift+V** or right-click.
**If it fails:** check that the SSH rule from 2.1 exists and that the instance shows *2/2 checks passed*.

### 4.2 Download the code and install Docker

```bash
git clone -b feature/ai-conversation-camera-checks https://github.com/akj951591-gif/hirebyte.git ~/app
cd ~/app/hirebyte
sudo bash deploy/ec2-setup.sh
echo "alias dc='sudo docker compose -f ~/app/hirebyte/docker-compose.prod.yml'" >> ~/.bashrc && source ~/.bashrc
```
**Expected result:** it ends with `Docker version …`, `Docker Compose version v2…` and
`EC2 setup finished.` From now on, `dc` is short for the Docker Compose command.
**If it fails:** `git: command not found` → `sudo apt-get install -y git`, then repeat. For
`Remote branch … not found`, check the branch name on GitHub. If your team merged to `main`, use
`-b main`.

### 4.3 Create the server settings file

```bash
cd ~/app/hirebyte
bash deploy/init-env.sh <CLOUDFRONT_DOMAIN>
nano .env
```
`init-env.sh` generates the database password, session secret and document-service token for you,
and sets `WEB_ORIGIN`/`APP_BASE_URL` to `https://<CLOUDFRONT_DOMAIN>`. In `nano`, fill in:

```
SEED_RECRUITER_EMAIL=<your demo recruiter email>
SEED_RECRUITER_PASSWORD=<12+ characters>
SEED_RECRUITER_NAME=<name shown in the app>
LLM_API_KEY=<Gemini key>
LLM_MODEL=<current Gemini Flash model name>
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<LiveKit key>
LIVEKIT_API_SECRET=<LiveKit secret>
```
Save with **Ctrl+O**, **Enter**, then exit with **Ctrl+X**.
**Expected result:** `grep -c '=$' .env` prints `0`, meaning no setting is left empty.

### 4.4 Build and start everything

```bash
dc up -d --build
```
**Expected result:** after 8–12 minutes, `Container hirebyte-prod-web-1 Started`. Then check:
```bash
dc ps
curl -s http://localhost/api/health
```
`dc ps` shows `api … (healthy)` and `postgres … (healthy)`; `documents` and `web` show `Up`.
The health check returns
`{"status":"ok","database":"ok",…,"media":"configured",…,"ai":"configured","documents":"configured"}`.
**If it fails:**
- `dc ps` shows api `Restarting`: run `dc logs --tail=50 api`. A line starting with
  `Invalid configuration:` names the setting to fix. Run `nano .env`, then `dc up -d`.
- The build stops with `Killed` or out of memory: run `free -h`. Swap should show 2.0Gi. Run
  `dc up -d --build` again.
- `"ai":"not_configured"`: `LLM_API_KEY` or `LLM_MODEL` is empty. `"media":"not_configured"`:
  one of the three `LIVEKIT_*` values is empty.

### 4.5 Create the recruiter account

```bash
dc exec api npm run db:seed
```
**Expected result:** `Seeded recruiter account <your email>.` Running it again just resets that
account's password to the value in `.env`.

---

## Phase 5 — Test the public URL (10 min)

Open `https://<CLOUDFRONT_DOMAIN>` (wait until CloudFront finishes *Deploying*).

- [ ] `https://<CLOUDFRONT_DOMAIN>/api/health` shows `"status":"ok"` and `"ai":"configured"`.
- [ ] The recruiter login page loads. Sign in with the seed account; the dashboard appears.
- [ ] Create an interview and upload a resume PDF. The resume shows as processed, which proves the document service works.
- [ ] **Generate questions** with AI, then mark the interview ready. You get an invitation link and an access code.
- [ ] In an incognito window, open the invitation link and enter the access code. Camera permission works on the device check page, and the AI interviewer greets you.
- [ ] Optional: scan the phone QR code from a phone. It opens `https://<CLOUDFRONT_DOMAIN>/…` and the phone camera starts.
- [ ] Answer, finish, and back as the recruiter watch the monitor page, then run **evaluation** and open the report.
- [ ] Browser DevTools (F12) → Console: no red errors except one `401` on the login page (the normal "not signed in yet" check).
- [ ] From a phone on **mobile data** (not your Wi-Fi), the URL opens. That is what the judges will see.

If a step fails: `dc logs --tail=100 api` shows the error with a `requestId`. The same ID is in
the browser's failed network response.

---

## Phase 6 — During the presentation

| Need | Command (in EC2 Instance Connect) |
| --- | --- |
| Is it running? | `dc ps` and `curl -s http://localhost/api/health` |
| Live logs | `dc logs -f --tail=100 api` (Ctrl+C to stop watching) |
| Restart one part | `dc restart api` (or `web`, `documents`) |
| Restart everything | `dc up -d` |
| Changed `.env` | `dc up -d` (recreates the API with the new values) |
| Deploy a code fix you pushed | `cd ~/app && git pull && dc up -d --build` |

- Keep the **EC2 instance running** and the **CloudFront distribution enabled** for the whole event.
- A reboot is safe: Docker starts on boot and every container has `restart: unless-stopped`.
  Database data lives on the EBS disk and survives restarts and reboots.
- Do not delete the Elastic IP or edit the CloudFront origin during the event.
- Open the URL 15 minutes before presenting, and keep a logged-in recruiter tab ready.

---

## Costs (estimates, ap-south-1, on-demand, October 2026)

| Item | Rate | A few hours (4 h) | One day | One month left running |
| --- | --- | --- | --- | --- |
| EC2 t3.medium | ~$0.0448/h | $0.18 | $1.08 | ~$32.70 |
| Public IPv4 (Elastic IP) | $0.005/h, charged even while the instance is stopped | $0.02 | $0.12 | $3.65 |
| EBS 20 GiB gp3 | ~$0.09/GB-month | <$0.01 | $0.06 | ~$1.80 |
| CloudFront (pay as you go) | always-free: 1 TB + 10M requests/month | $0 | $0 | $0 for demo traffic |
| Data EC2 → CloudFront | free | $0 | $0 | $0 |
| **Total** | | **≈ $0.20** | **≈ $1.30** | **≈ $38** |

- Video goes straight from browsers to LiveKit Cloud, and AI calls go to Google, so they add no AWS
  data transfer. Their own free tiers apply.
- New AWS accounts usually get free-tier credits that cover all of this. Check **Billing → Credits**.
- **Stopping** the instance does not stop every charge. EBS and the Elastic IP keep billing (≈ $5.50/month).

## After the hackathon: delete everything (10 min)

1. **CloudFront** → select the distribution → **Disable** → wait until it shows *Deployed* → **Delete**.
2. **EC2** → select `hirebyte-demo` → Actions → Instance settings → Change termination protection →
   **disable** → Instance state → **Terminate**. The 20 GiB disk is deleted with it.
3. **EC2 → Elastic IPs** → select the address → Actions → **Release**. Skip this and it costs about
   $3.65/month on its own.
4. Check **EC2 → Volumes** and **EC2 → Snapshots** are empty, and the next day check **Billing → Bills**.

## Not included (on purpose)

- **Recordings** stay off (`RECORDING_ENABLED=false`). Turning them on needs a private S3 bucket,
  an IAM access key that LiveKit can upload with, the `STORAGE_*` settings (`STORAGE_PROVIDER=s3`,
  `STORAGE_ENDPOINT=https://s3.ap-south-1.amazonaws.com`), and a LiveKit webhook pointing at
  `https://<CLOUDFRONT_DOMAIN>/api/webhooks/livekit/egress`. The backend README notes these have not
  been tried with real accounts yet.
- RDS, load balancers, ECS, Redis (the code uses none) and CI/CD are all unnecessary for one day.
