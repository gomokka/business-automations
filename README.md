# Business Automations

Automated workflows for business processes, reporting, and stakeholder communication.

## Features

### Weekly Release Notes Automation
- **When**: Every Monday at 9:00 AM Israel time
- **What**: Automatically generates and posts product release notes to Slack
- **Where**: #announcements channel via Mokka Release Update Bot

## Setup

### Required Secrets
Configure these in repository Settings → Secrets and variables → Actions:

1. **SLACK_WEBHOOK_URL**: `https://hooks.slack.com/services/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`
2. **JIRA_API_TOKEN**: Your Jira API token for accessing ticket details

### Manual Trigger
You can manually trigger the changelog generation:
1. Go to Actions tab
2. Select "Weekly Product Release Notes" 
3. Click "Run workflow"

## How It Works

1. **Searches GitHub**: Finds all PRs merged to main/master in the last 7 days across gomokka organization
2. **Extracts Information**: Gets contributor names, KAN ticket references, and business impact descriptions
3. **Categorizes Changes**: Organizes into Features, UX, Website, and Infrastructure sections
4. **Posts to Slack**: Formats as release notes and sends to #announcements channel

## Files

- `scripts/changelog-generator.js` - Main script that generates the changelog
- `.github/workflows/weekly-changelog.yml` - GitHub Action that runs weekly
- `README.md` - This documentation