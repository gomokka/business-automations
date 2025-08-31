#!/usr/bin/env node

const { execSync } = require('child_process');

// Configuration
const GITHUB_ORG = 'gomokka';
const JIRA_ENDPOINT = 'https://go-mokka.atlassian.net';
const JIRA_USER = 'max@gomokka.com';

// Get date range for last 7 days
function getLastWeekRange() {
  // Get current date in UTC to ensure consistency across environments
  const today = new Date();
  console.log('Current date:', today.toISOString());
  
  // Get the last 7 days (from 7 days ago to today)
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  
  const range = {
    start: sevenDaysAgo.toISOString().split('T')[0],
    end: today.toISOString().split('T')[0]
  };
  
  console.log('Date range for last 7 days:', range);
  return range;
}

// Get full name from GitHub API
async function getGitHubFullName(username) {
  try {
    const result = execSync(`gh api users/${username} --jq '.name // .login'`, { encoding: 'utf8' });
    return result.trim();
  } catch (error) {
    console.warn(`Could not get full name for ${username}, using username`);
    return username;
  }
}

// Extract KAN ticket references from text
function extractKanTickets(text) {
  const kanRegex = /KAN-(\d+)/gi;
  const matches = [...text.matchAll(kanRegex)];
  return [...new Set(matches.map(match => match[0].toUpperCase()))];
}

// Get PR data from GitHub
async function getPRsFromLastWeek() {
  const { start, end } = getLastWeekRange();
  
  try {
    // Search for PRs merged to main/master branches across ALL repositories  
    console.log(`Searching for PRs with: --owner=${GITHUB_ORG} --merged-at=${start}..${end}`);
    
    const mainPRs = execSync(`gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=main --limit=50 --json title,number,url,body,author,repository`, { encoding: 'utf8' });
    console.log('Main PRs result length:', mainPRs.length);
    console.log('Main PRs raw result:', mainPRs.substring(0, 200) + '...');
    
    const masterPRs = execSync(`gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=master --limit=50 --json title,number,url,body,author,repository`, { encoding: 'utf8' });
    console.log('Master PRs result length:', masterPRs.length);
    console.log('Master PRs raw result:', masterPRs.substring(0, 200) + '...');
    
    let mainPRsData = [];
    let masterPRsData = [];
    
    try {
      mainPRsData = JSON.parse(mainPRs || '[]');
      console.log('Main PRs parsed successfully:', mainPRsData.length);
    } catch (error) {
      console.error('Error parsing main PRs JSON:', error.message);
      console.log('Raw main PRs data:', mainPRs);
    }
    
    try {
      masterPRsData = JSON.parse(masterPRs || '[]');
      console.log('Master PRs parsed successfully:', masterPRsData.length);
    } catch (error) {
      console.error('Error parsing master PRs JSON:', error.message);
      console.log('Raw master PRs data:', masterPRs);
    }
    
    const allPRs = [...mainPRsData, ...masterPRsData];
    console.log('Total PRs before deduplication:', allPRs.length);
    
    // Remove duplicates by URL
    const uniquePRs = allPRs.filter((pr, index, self) => 
      index === self.findIndex(p => p.url === pr.url)
    );
    console.log('Unique PRs after deduplication:', uniquePRs.length);
    
    return uniquePRs;
  } catch (error) {
    console.error('Error fetching PRs:', error.message);
    return [];
  }
}

// Generate changelog from PR data
async function generateChangelog(prs) {
  const changelog = {
    features: [],
    ux: [],
    website: [],
    infrastructure: []
  };
  
  // Process each PR
  for (const pr of prs) {
    const title = pr.title;
    const body = pr.body || '';
    const contributor = await getGitHubFullName(pr.author.login);
    const kanTickets = extractKanTickets(title + ' ' + body);
    const prNumber = pr.number;
    const repoName = pr.repository.name;
    
    // Skip release PRs without meaningful content
    if (title.toLowerCase() === 'release' && !body.includes('KAN-')) {
      continue;
    }
    
    // Categorize based on title/content
    const entry = {
      title,
      body,
      contributor,
      kanTickets,
      prNumber,
      repoName
    };
    
    // Simple categorization logic
    if (title.includes('feat') || body.includes('ATS integration') || body.includes('AI interview')) {
      changelog.features.push(entry);
    } else if (title.includes('sales-website') || repoName === 'sales-website') {
      changelog.website.push(entry);
    } else if (title.includes('fix') || title.includes('UX') || body.includes('candidate')) {
      changelog.ux.push(entry);
    } else {
      changelog.infrastructure.push(entry);
    }
  }
  
  return changelog;
}

// Format changelog for Slack (using Slack formatting)
function formatChangelog(changelog) {
  const { start, end } = getLastWeekRange();
  
  let slack = `*Weekly Product Release Notes*\n_${start} - ${end}_\n\n`;
  
  if (changelog.features.length > 0) {
    slack += `*🚀 Major Features & Integrations*\n\n`;
    changelog.features.forEach(item => {
      const kanRef = item.kanTickets.length > 0 ? `[${item.kanTickets.join(', ')}] ` : '';
      const businessValue = extractBusinessValue(item.body);
      slack += `• *${item.title}*: ${businessValue} _${kanRef}(${item.contributor}) - PR #${item.prNumber}_\n`;
    });
    slack += '\n';
  }
  
  if (changelog.ux.length > 0) {
    slack += `*🔧 User Experience & Workflow*\n\n`;
    changelog.ux.forEach(item => {
      const kanRef = item.kanTickets.length > 0 ? `[${item.kanTickets.join(', ')}] ` : '';
      const businessValue = extractBusinessValue(item.body);
      slack += `• *${item.title}*: ${businessValue} _${kanRef}(${item.contributor}) - PR #${item.prNumber}_\n`;
    });
    slack += '\n';
  }
  
  if (changelog.website.length > 0) {
    slack += `*🌐 Website & Marketing*\n\n`;
    changelog.website.forEach(item => {
      const kanRef = item.kanTickets.length > 0 ? `[${item.kanTickets.join(', ')}] ` : '';
      const businessValue = extractBusinessValue(item.body);
      slack += `• *${item.title}*: ${businessValue} _${kanRef}(${item.contributor}) - PR #${item.prNumber}_\n`;
    });
    slack += '\n';
  }
  
  if (changelog.infrastructure.length > 0) {
    slack += `*🛠️ Technical Infrastructure*\n\n`;
    changelog.infrastructure.forEach(item => {
      const kanRef = item.kanTickets.length > 0 ? `[${item.kanTickets.join(', ')}] ` : '';
      const businessValue = extractBusinessValue(item.body);
      slack += `• *${item.title}*: ${businessValue} _${kanRef}(${item.contributor}) - PR #${item.prNumber}_\n`;
    });
  }
  
  return slack;
}

// Extract business value from PR body with enhanced extraction
function extractBusinessValue(body) {
  if (!body) return 'Technical improvements and updates';
  
  // Look for Impact section first
  const impactMatch = body.match(/\*\*Impact:\*\*\s*(.+?)(?:\r?\n\s*\r?\n|\r?\n\s*\*\*|$)/is);
  if (impactMatch) {
    return cleanDescription(impactMatch[1].trim());
  }
  
  // Look for Summary section
  const summaryMatch = body.match(/##?\s*Summary\s*\r?\n\s*(.+?)(?:\r?\n\s*\r?\n|\r?\n\s*##|$)/is);
  if (summaryMatch) {
    return cleanDescription(summaryMatch[1].trim());
  }
  
  // Look for What/Description section
  const whatMatch = body.match(/##?\s*(?:What|Description)\s*\r?\n\s*(.+?)(?:\r?\n\s*\r?\n|\r?\n\s*##|$)/is);
  if (whatMatch) {
    return cleanDescription(whatMatch[1].trim());
  }
  
  // Look for bullet points describing changes
  const bulletMatch = body.match(/^\s*[-*]\s+(.+?)$/m);
  if (bulletMatch) {
    const description = bulletMatch[1].trim();
    if (description.length > 20) {
      return cleanDescription(description);
    }
  }
  
  // Get first substantial paragraph (skip short lines)
  const lines = body.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && 
           trimmed.length > 20 &&
           !trimmed.startsWith('#') && 
           !trimmed.startsWith('*') && 
           !trimmed.startsWith('-') &&
           !trimmed.includes('Contributors:') &&
           !trimmed.startsWith('Co-authored-by:') &&
           !trimmed.match(/^\w+:\s/) && // Skip "Type: feature" etc
           !trimmed.match(/^https?:/); // Skip URLs
  });
  
  if (lines.length > 0) {
    return cleanDescription(lines[0].trim());
  }
  
  return 'Technical improvements and updates';
}

// Clean and format description for better readability
function cleanDescription(description) {
  if (!description) return 'Technical improvements and updates';
  
  // Remove excessive whitespace and newlines
  let cleaned = description.replace(/\s+/g, ' ').trim();
  
  // Remove markdown formatting
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1'); // Remove italics
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // Remove code backticks
  
  // Truncate if too long but try to end at a sentence
  if (cleaned.length > 250) {
    const truncated = cleaned.substring(0, 250);
    const lastSentence = truncated.lastIndexOf('.');
    if (lastSentence > 100) {
      cleaned = truncated.substring(0, lastSentence + 1);
    } else {
      cleaned = truncated + '...';
    }
  }
  
  // Ensure it ends with proper punctuation
  if (!cleaned.match(/[.!?]$/)) {
    cleaned += '.';
  }
  
  return cleaned;
}

// Post to Slack
async function postToSlack(markdown) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('SLACK_WEBHOOK_URL environment variable not set');
    return;
  }
  
  console.log('Posting to Slack webhook...');
  console.log('Webhook URL (first 50 chars):', webhookUrl.substring(0, 50) + '...');
  
  const payload = {
    text: markdown,
    username: "Mokka Release Update Bot"
  };
  
  try {
    const result = execSync(`curl -X POST -H 'Content-type: application/json' --data '${JSON.stringify(payload)}' ${webhookUrl}`, { encoding: 'utf8' });
    console.log('Curl response:', result);
    console.log('Successfully posted to Slack!');
  } catch (error) {
    console.error('Error posting to Slack:', error.message);
    console.error('Error details:', error);
  }
}

// Main function
async function main() {
  console.log('Generating weekly changelog...');
  
  try {
    const prs = await getPRsFromLastWeek();
    console.log(`Found ${prs.length} PRs from last week`);
    
    if (prs.length === 0) {
      console.log('No PRs found for last week');
      return;
    }
    
    const changelog = await generateChangelog(prs);
    const slackMessage = formatChangelog(changelog);
    
    console.log('Generated changelog:');
    console.log(slackMessage);
    
    if (process.env.SLACK_WEBHOOK_URL) {
      await postToSlack(slackMessage);
    } else {
      console.log('SLACK_WEBHOOK_URL not set, skipping Slack post');
    }
    
  } catch (error) {
    console.error('Error generating changelog:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, generateChangelog, formatChangelog };