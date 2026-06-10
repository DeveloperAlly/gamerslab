1. Install Wrangler CLI

npm install -g wrangler
wrangler login


3. Secrets
   
# Set the target URL as a secret (not in wrangler.toml)
wrangler secret put TARGET_URL
# paste your URL when prompted

# Deploy
wrangler deploy


5. Matrix.include

- region: me-south
  runner: ubuntu-latest
- region: af-south
  runner: ubuntu-latest

Secrets summary
WhereSecretValueGitHubWORKER_URLhttps://geo-monitor.your-account.workers.devGitHubSUPABASE_URLYour Supabase project URLGitHubSUPABASE_SERVICE_KEYService role keyCloudflare (via wrangler)TARGET_URLThe URL you're monitoring
