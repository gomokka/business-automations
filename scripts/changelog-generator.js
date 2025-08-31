#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

// Configuration
const GITHUB_ORG = 'gomokka';
const JIRA_ENDPOINT = 'https://go-mokka.atlassian.net';
const JIRA_USER = 'max@gomokka.com';

// Get date range for last 7 days with proper timestamps to prevent overlaps
function getLastWeekRange() {
  const now = new Date();
  console.log('Current timestamp:', now.toISOString());
  
  // Use exact timestamps to prevent overlaps
  // End: current moment, Start: exactly 7 days ago from this moment
  const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  
  const range = {
    start: sevenDaysAgo.toISOString().split('T')[0], // Keep date format for display
    end: now.toISOString().split('T')[0],
    startTimestamp: sevenDaysAgo.toISOString(), // Full timestamp for API calls
    endTimestamp: now.toISOString()
  };
  
  console.log('Date range with timestamps:', range);
  return range;
}

// Contributor name mapping for known team members
const contributorMap = {
  'oliveiramarcio-gomokka': 'Marcio Oliveira',
  'ahmedLawal': 'Ahmed Lawal',
  'ak-mokka': 'Alex Khazanovitch', 
  'ShaheryarAbid': 'Shaheryar',
  'aniket-mokka': 'Aniket',
  'Aneesh-gomokka': 'Aneesh',
  'vinicius-nepomuceno-gomokka': 'Vinicius Nepomuceno'
};

// Get full name with mapping fallback to GitHub API
async function getGitHubFullName(username) {
  // Check mapping first
  if (contributorMap[username]) {
    return contributorMap[username];
  }
  
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

// Get PR data from GitHub using precise timestamps
async function getPRsFromLastWeek() {
  const { start, end, startTimestamp, endTimestamp } = getLastWeekRange();
  
  try {
    // Search for PRs merged to main/master branches using precise timestamps to prevent overlaps
    console.log(`Searching for PRs with timestamps: --owner=${GITHUB_ORG} --merged-at=${startTimestamp}..${endTimestamp}`);
    
    const mainPRs = execSync(`gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=main --limit=50 --json title,number,url,body,author,repository,closedAt`, { encoding: 'utf8' });
    console.log('Main PRs result length:', mainPRs.length);
    console.log('Main PRs raw result:', mainPRs.substring(0, 200) + '...');
    
    const masterPRs = execSync(`gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=master --limit=50 --json title,number,url,body,author,repository,closedAt`, { encoding: 'utf8' });
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
    all: []
  };
  
  // Process each PR
  for (const pr of prs) {
    const title = pr.title;
    const body = pr.body || '';
    
    // Enhanced contributor detection - parse all contributors from Release PRs
    let contributor = await getGitHubFullName(pr.author.login);
    let allContributors = [contributor]; // Start with PR author
    
    // For Release PRs, parse the Contributors section to get all actual contributors
    if (title.toLowerCase() === 'release' && body) {
      const contributorsMatch = body.match(/\*\*Contributors:\*\*\s*(.+)/i);
      if (contributorsMatch) {
        // Extract @mentions and convert to display names
        const mentions = contributorsMatch[1].match(/@([a-zA-Z0-9-_]+)/g) || [];
        const releaseContributors = [];
        
        for (const mention of mentions) {
          const username = mention.substring(1); // Remove @
          if (username !== 'bot' && !username.includes('[bot]')) {
            const fullName = await getGitHubFullName(username);
            releaseContributors.push(fullName);
          }
        }
        
        if (releaseContributors.length > 0) {
          allContributors = releaseContributors;
          // For display purposes, use the first contributor or all if multiple
          contributor = releaseContributors.length === 1 ? 
            releaseContributors[0] : 
            releaseContributors.join(', ');
        }
      }
    }
    
    const kanTickets = extractKanTickets(title + ' ' + body);
    const prNumber = pr.number;
    const repoName = pr.repository.name;
    const prUrl = pr.url;
    
    // Process ALL PRs - let the LLM decide what's important
    const entry = {
      title,
      body,
      contributor,
      allContributors, // Include all contributors for LLM context
      kanTickets,
      prNumber,
      repoName,
      url: prUrl
    };
    
    changelog.all.push(entry);
  }
  
  return changelog;
}

// Format changelog for Slack using batch LLM processing
async function formatChangelog(changelog) {
  const { start, end } = getLastWeekRange();
  
  // Collect all PR data with Jira context for batch processing
  const allPRs = [];
  
  for (const item of changelog.all) {
    // Get Jira context for the first ticket (if available)
    let jiraContext = null;
    if (item.kanTickets.length > 0) {
      jiraContext = await getJiraTicketDetails(item.kanTickets[0]);
    }
    
    allPRs.push({
      ...item,
      jiraContext
    });
  }
  
  // Generate the entire changelog using a single LLM call
  const formattedChangelog = await generateBatchChangelog(allPRs, { start, end });
  
  return formattedChangelog;
}

// Get Jira ticket details with enhanced error handling
async function getJiraTicketDetails(ticketKey) {
  if (!process.env.JIRA_API_TOKEN) {
    console.log(`Skipping Jira fetch for ${ticketKey} - no JIRA_API_TOKEN`);
    return null;
  }
  
  try {
    const jiraUser = 'max@gomokka.com';
    const jiraEndpoint = 'https://go-mokka.atlassian.net';
    const jiraToken = process.env.JIRA_API_TOKEN;
    
    console.log(`Fetching Jira ticket: ${ticketKey}`);
    const auth = Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64');
    
    const result = execSync(`curl -s -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" "${jiraEndpoint}/rest/api/2/issue/${ticketKey}?fields=summary,description,issuetype"`, { encoding: 'utf8' });
    
    console.log(`Jira API response for ${ticketKey}:`, result.substring(0, 200) + '...');
    
    const ticketData = JSON.parse(result);
    
    if (ticketData.errorMessages) {
      console.warn(`Jira API error for ${ticketKey}:`, ticketData.errorMessages);
      return null;
    }
    
    const jiraInfo = {
      summary: ticketData.fields?.summary || '',
      description: ticketData.fields?.description || '',
      issueType: ticketData.fields?.issuetype?.name || ''
    };
    
    console.log(`Successfully fetched ${ticketKey}:`, jiraInfo.summary);
    return jiraInfo;
  } catch (error) {
    console.warn(`Error fetching Jira ticket ${ticketKey}:`, error.message);
    return null;
  }
}

// Generate complete changelog using batch LLM processing
async function generateBatchChangelog(allPRs, dateRange) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set, falling back to basic format');
    return generateBasicChangelog(allPRs, dateRange);
  }
  
  try {
    // Build comprehensive context for all PRs
    let prContext = '';
    allPRs.forEach((pr, index) => {
      prContext += `\nPR ${index + 1}:\n`;
      prContext += `- Title: ${pr.title}\n`;
      prContext += `- Repository: ${pr.repoName}\n`;
      prContext += `- PR Author: ${pr.contributor}\n`;
      if (pr.allContributors && pr.allContributors.length > 1) {
        prContext += `- All Contributors: ${pr.allContributors.join(', ')}\n`;
      }
      prContext += `- PR Number: ${pr.prNumber}\n`;
      prContext += `- PR URL: ${pr.url}\n`;
      
      if (pr.kanTickets && pr.kanTickets.length > 0) {
        prContext += `- Jira Tickets: ${pr.kanTickets.join(', ')}\n`;
        const jiraUrls = pr.kanTickets.map(ticket => `https://go-mokka.atlassian.net/browse/${ticket}`);
        prContext += `- Jira URLs: ${jiraUrls.join(', ')}\n`;
        
        if (pr.jiraContext) {
          prContext += `- Jira Summary: ${pr.jiraContext.summary}\n`;
          prContext += `- Jira Type: ${pr.jiraContext.issueType}\n`;
          if (pr.jiraContext.description && pr.jiraContext.description.trim()) {
            prContext += `- Jira Description: ${pr.jiraContext.description.substring(0, 200)}...\n`;
          }
        }
      }
      
      if (pr.body && pr.body.trim()) {
        // Extract key information from PR body
        const body = pr.body.substring(0, 500); // Limit to avoid token overflow
        prContext += `- PR Body: ${body}\n`;
      }
    });
    
    const prompt = `You are creating a weekly product update for Mokka, an AI-powered recruitment platform. Generate a complete, well-formatted Slack changelog from the provided PR data.

MOKKA PLATFORM CONTEXT:
- AI-powered recruitment platform for companies to evaluate candidates  
- Core features: AI interviews, candidate scoring, ATS integrations (Workable, SparkHire, Kombo)
- Users: Recruiters, HR teams, hiring managers
- Key workflows: Candidate invitation → AI interview → Scoring → ATS sync → Hiring decisions

PR DATA TO PROCESS:
${prContext}

REQUIRED OUTPUT FORMAT:
Create a Slack-formatted changelog with this exact structure:

*Weekly Product Update*
_${dateRange.start} - ${dateRange.end}_

*🔥 Week Highlights*

1. [Most important change description] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](PR_URL)_
2. [Second most important change] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](PR_URL)_  
3. [Third most important change] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](PR_URL)_

*📋 All Changes*

*🚀 Major Features & Integrations*

• [Specific description] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](https://github.com/gomokka/repo/pull/XXX)_

*🔧 User Experience & Workflow*

• [Specific description] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](https://github.com/gomokka/repo/pull/XXX)_

*🌐 Website & Marketing*  

• [Specific description] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](https://github.com/gomokka/repo/pull/XXX)_

*🛠️ Technical Infrastructure*

• [Specific description] _[KAN-XXX](https://go-mokka.atlassian.net/browse/KAN-XXX) (Contributor Name) - [PR #XXX](https://github.com/gomokka/repo/pull/XXX)_

CATEGORIZATION & DESCRIPTION GUIDELINES:
- CATEGORIZE each PR into the most appropriate section based on its actual impact:
  * 🚀 Major Features & Integrations: New features, ATS integrations, AI improvements  
  * 🔧 User Experience & Workflow: UI changes, candidate management, workflow improvements
  * 🌐 Website & Marketing: Sales website, marketing pages, public-facing changes
  * 🛠️ Technical Infrastructure: Security updates, model changes, database changes, dependency updates
- Write 1 sentence describing exactly WHAT was done (be specific about technical details)
- Include specific details: model names (GPT-4, GPT-4o-mini), service names, version numbers, API endpoints, dependency versions
- For security fixes: mention specific vulnerabilities addressed (golang.org/x/crypto, golang.org/x/net versions)
- For model changes: specify which AI models were updated (rnr_experience, etc.)
- For integrations: specify which services/APIs were connected  
- For UI changes: describe which specific screens/workflows were modified
- Avoid vague terms like "enhanced", "improved", "optimized" without specifics
- Prioritize Features section items for Week Highlights, then UX, then Infrastructure (especially security), then Website

CONTRIBUTOR ATTRIBUTION GUIDELINES:
- For Release PRs: Credit the person who actually did the work, not just the release author
- For dependency updates by Dependabot: Credit the person who approved/merged, not the bot
- When multiple contributors are listed, credit the primary contributor based on the work type
- Use your judgment to determine the most appropriate contributor based on the work content

HANDLING MINIMAL DATA PRs - SPECIFIC EXAMPLES:
- PR title "Release" in past_roles_scorer repo → "Released updates to the past_roles_scorer service for improved candidate role evaluation"
- PR title "Change rnr_experience model" → "Updated the rnr_experience AI model in candidate-scoring-service to improve experience evaluation accuracy"
- PR title "updates go.mod" → "Updated Go module dependencies in [repo_name] service for improved security and performance"
- NEVER use vague terms like "General release update" - always be specific about the service and potential impact
- Use repository name to infer service purpose: scoring services = evaluation improvements, api services = performance/reliability, frontend = user experience

OUTPUT FORMATTING - CRITICAL REQUIREMENTS:
- MANDATORY: Use markdown hyperlink format for ALL Jira tickets: [KAN-123](https://go-mokka.atlassian.net/browse/KAN-123)
- MANDATORY: Use markdown hyperlink format for ALL PRs: [PR #123](https://github.com/gomokka/repo/pull/123)
- NEVER use plain text like "KAN-123" or "PR #123" - ALWAYS make them clickable links
- NEVER use backticks around technical terms - they create distracting red highlights in Slack
- Technical terms should be in plain text: book_a_demo, TestTaskInvitationEmailTemplate, rnr_experience
- Replace PR_URL_PROVIDED with the actual PR URL from the data
- Example correct format: _[KAN-2692](https://go-mokka.atlassian.net/browse/KAN-2692) (Marcio Oliveira) - [PR #1126](https://github.com/gomokka/application-frontend/pull/1126)_

EXAMPLES OF GOOD DESCRIPTIONS:
- "Switched AI model from GPT-4 to GPT-4o-mini for candidate interview analysis to reduce processing costs"
- "Fixed auto-rejection rules for salary requirements that incorrectly filtered out candidates within the specified range" 
- "Added automated candidate score sync with Workable ATS API to eliminate manual data entry after interviews"
- "Extended candidate assessment link validity from 7 days to 30 days in invitation emails"

Generate the complete changelog now:`;
    
    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        maxOutputTokens: 20000,
        temperature: 0.3
      }
    };
    
    // Write payload to temp file to avoid shell escaping issues
    const tempFile = `/tmp/gemini-batch-${Date.now()}.json`;
    fs.writeFileSync(tempFile, JSON.stringify(payload));
    
    console.log(`Making batch Gemini API call for ${allPRs.length} PRs...`);
    const result = execSync(`curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}" \
      -H "Content-Type: application/json" \
      -d @${tempFile}`, { encoding: 'utf8' });
    
    console.log(`Batch Gemini API response: ${result.substring(0, 200)}...`);
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    const response = JSON.parse(result);
    
    if (response.error) {
      const errorMsg = `Gemini API Error: ${response.error.message} (Code: ${response.error.code})`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      
      // Check for MAX_TOKENS or other finish reasons
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini response truncated due to MAX_TOKENS limit - increase maxOutputTokens or reduce input size');
      }
      
      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Gemini response blocked due to safety filters');
      }
      
      if (candidate.content && candidate.content.parts) {
        const changelog = candidate.content.parts[0].text.trim();
        return changelog;
      }
    }
    
    throw new Error('Unexpected Gemini API response format: ' + JSON.stringify(response));
  } catch (error) {
    console.warn('Error calling batch Gemini API:', error.message);
    throw error; // Re-throw so main function can handle it
  }
  
  // Fallback to basic format
  return generateBasicChangelog(allPRs, dateRange);
}

// Generate basic changelog format (fallback when LLM isn't available)  
function generateBasicChangelog(allPRs, dateRange) {
  let slack = `*Weekly Product Update*\n_${dateRange.start} - ${dateRange.end}_\n\n`;
  
  // Group PRs by section
  const sections = {
    'Features': allPRs.filter(pr => pr.section === 'Features'),
    'UX': allPRs.filter(pr => pr.section === 'UX'), 
    'Website': allPRs.filter(pr => pr.section === 'Website'),
    'Infrastructure': allPRs.filter(pr => pr.section === 'Infrastructure')
  };
  
  // Add top highlights (first 3 PRs prioritized by Features, UX, then others)
  const sortedPRs = allPRs.sort((a, b) => b.priority - a.priority);
  const highlights = sortedPRs.slice(0, 3);
  
  if (highlights.length > 0) {
    slack += `*🔥 Week Highlights*\n\n`;
    highlights.forEach((pr, index) => {
      const kanRef = pr.kanTickets && pr.kanTickets.length > 0 ? `[${pr.kanTickets.join(', ')}] ` : '';
      const description = extractBasicBusinessValue(pr.body, pr.title);
      slack += `${index + 1}. ${description} _${kanRef}(${pr.contributor}) - PR #${pr.prNumber}_\n`;
    });
    slack += '\n';
  }
  
  slack += `*📋 All Changes*\n\n`;
  
  // Add sections with their emojis
  const sectionConfig = {
    'Features': '🚀 Major Features & Integrations',
    'UX': '🔧 User Experience & Workflow', 
    'Website': '🌐 Website & Marketing',
    'Infrastructure': '🛠️ Technical Infrastructure'
  };
  
  Object.entries(sectionConfig).forEach(([key, title]) => {
    const items = sections[key];
    if (items && items.length > 0) {
      slack += `*${title}*\n\n`;
      items.forEach(pr => {
        const kanRef = pr.kanTickets && pr.kanTickets.length > 0 ? `[${pr.kanTickets.join(', ')}] ` : '';
        const description = extractBasicBusinessValue(pr.body, pr.title);
        slack += `• ${description} _${kanRef}(${pr.contributor}) - PR #${pr.prNumber}_\n`;
      });
      slack += '\n';
    }
  });
  
  return slack.trim();
}

// Basic business value extraction (fallback when LLM isn't available)
function extractBasicBusinessValue(body, title = '') {
  // Look for Impact section first
  const impactMatch = body && body.match(/\*\*Impact:\*\*\s*(.+?)(?:\r?\n\s*\r?\n|\r?\n\s*\*\*|$)/is);
  if (impactMatch) {
    return cleanDescription(impactMatch[1].trim());
  }
  
  // Look for Summary section
  const summaryMatch = body && body.match(/##?\s*Summary\s*\r?\n\s*(.+?)(?:\r?\n\s*\r?\n|\r?\n\s*##|$)/is);
  if (summaryMatch) {
    return cleanDescription(summaryMatch[1].trim());
  }
  
  // Simple business mapping for common patterns
  if (title) {
    if (title.match(/ATS|integration/i)) return 'Enhanced ATS integration capabilities for better candidate management.';
    if (title.match(/AI interview|scoring/i)) return 'Improved AI-powered candidate evaluation and scoring.';
    if (title.match(/candidate.*tab|workflow/i)) return 'Enhanced candidate management workflow and organization.';
    if (title.match(/calendar|demo/i)) return 'Improved scheduling and calendar integration features.';
  }
  
  return 'Technical improvements to enhance system reliability and performance.';
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
    // Write JSON payload to a temporary file to avoid shell escaping issues
    const fs = require('fs');
    const tempFile = '/tmp/slack_payload.json';
    fs.writeFileSync(tempFile, JSON.stringify(payload));
    
    const result = execSync(`curl -X POST -H 'Content-type: application/json' --data @${tempFile} ${webhookUrl}`, { encoding: 'utf8' });
    console.log('Curl response:', result);
    console.log('Successfully posted to Slack!');
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
  } catch (error) {
    console.error('Error posting to Slack:', error.message);
    console.error('Error details:', error);
  }
}

// Post error to Slack
async function postErrorToSlack(error, context = '') {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('Cannot post error to Slack: SLACK_WEBHOOK_URL not set');
    return;
  }
  
  const { start, end } = getLastWeekRange();
  const errorMessage = `*❌ Weekly Changelog Generation Failed*
_${start} - ${end}_

**Error:** ${error.message || error}
**Context:** ${context}

**Stack Trace:**
\`\`\`
${error.stack || 'No stack trace available'}
\`\`\`

*This is an automated error report from the changelog generator.*`;

  try {
    const payload = {
      text: errorMessage,
      username: "Mokka Release Update Bot"
    };
    
    // Write JSON payload to a temporary file to avoid shell escaping issues
    const fs = require('fs');
    const tempFile = '/tmp/slack_error_payload.json';
    fs.writeFileSync(tempFile, JSON.stringify(payload));
    
    const result = execSync(`curl -X POST -H 'Content-type: application/json' --data @${tempFile} ${webhookUrl}`, { encoding: 'utf8' });
    console.log('Error posted to Slack successfully');
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
  } catch (slackError) {
    console.error('Failed to post error to Slack:', slackError.message);
  }
}

// Main function
async function main() {
  console.log('Generating weekly changelog...');
  
  try {
    const prs = await getPRsFromLastWeek();
    console.log(`Found ${prs.length} PRs from last week`);
    
    if (prs.length === 0) {
      const noDataMessage = `*📭 Weekly Product Update*
_No changes were merged to main/master branches this week_

*This is normal during lighter development periods.*`;
      
      if (process.env.SLACK_WEBHOOK_URL) {
        await postToSlack(noDataMessage);
      } else {
        console.log('No PRs found and SLACK_WEBHOOK_URL not set');
      }
      return;
    }
    
    const changelog = await generateChangelog(prs);
    console.log('Generating business descriptions using LLM + Jira integration...');
    const slackMessage = await formatChangelog(changelog);
    
    console.log('Generated changelog:');
    console.log(slackMessage);
    
    if (process.env.SLACK_WEBHOOK_URL) {
      await postToSlack(slackMessage);
    } else {
      console.log('SLACK_WEBHOOK_URL not set, skipping Slack post');
    }
    
  } catch (error) {
    console.error('Error generating changelog:', error.message);
    
    // Post error to Slack if webhook is available
    await postErrorToSlack(error, 'Main changelog generation process');
    
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, generateChangelog, formatChangelog };