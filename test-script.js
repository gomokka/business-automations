#!/usr/bin/env node

const { execSync } = require('child_process');

// Test the exact same search the script uses
const GITHUB_ORG = 'gomokka';

function getDateRange() {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  
  return {
    start: sevenDaysAgo.toISOString().split('T')[0],
    end: today.toISOString().split('T')[0]
  };
}

async function testSearch() {
  const { start, end } = getDateRange();
  console.log(`Testing search: --owner=${GITHUB_ORG} --merged-at=${start}..${end}`);
  
  try {
    // Test main branch search
    console.log('\n=== Testing main branch ===');
    const mainCmd = `gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=main --limit=10 --json title,number,url,repository`;
    console.log('Command:', mainCmd);
    const mainPRs = execSync(mainCmd, { encoding: 'utf8' });
    const mainData = JSON.parse(mainPRs);
    console.log('Main PRs found:', mainData.length);
    mainData.forEach(pr => console.log(`- ${pr.repository.name}#${pr.number}: ${pr.title}`));
    
    // Test master branch search  
    console.log('\n=== Testing master branch ===');
    const masterCmd = `gh search prs --owner=${GITHUB_ORG} --state=closed --merged --merged-at=${start}..${end} --base=master --limit=10 --json title,number,url,repository`;
    console.log('Command:', masterCmd);
    const masterPRs = execSync(masterCmd, { encoding: 'utf8' });
    const masterData = JSON.parse(masterPRs);
    console.log('Master PRs found:', masterData.length);
    masterData.forEach(pr => console.log(`- ${pr.repository.name}#${pr.number}: ${pr.title}`));
    
    console.log('\n=== Summary ===');
    console.log('Total PRs:', mainData.length + masterData.length);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testSearch();