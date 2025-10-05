const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const { Builder, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Bot configuration from environment variables
const TOKEN = process.env.DISCORD_TOKEN || 
const LOOKUP_CHANNEL_ID = process.env.LOOKUP_CHANNEL_ID || 
const WEBHOOK_URL = process.env.WEBHOOK_URL || 
const PRIVATE_INV_WEBHOOK_URL = process.env.PRIVATE_INV_WEBHOOK_URL ||
const BOT_ID = process.env.BOT_ID || 

// All possible whois channels where responses might come from
const WHOIS_CHANNEL_IDS = [
  LOOKUP_CHANNEL_ID,
  '1135707897964265620'
];

// User IDs from environment variable (comma-separated) or file fallback
const USER_IDS_ENV = process.env.USER_IDS; // Comma-separated list

let driver;
let userIdsToProcess = [];
let currentIndex = 0;
let isProcessing = false;

async function loadUserIds() {
  try {
    // Try to load from environment variable first
    if (USER_IDS_ENV) {
      console.log('Loading user IDs from environment variable...');
      userIdsToProcess = USER_IDS_ENV
        .split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      console.log(`Loaded ${userIdsToProcess.length} user IDs from environment variable`);
      return userIdsToProcess.length > 0;
    }
    
    // Fallback to file
    console.log('Loading user IDs from file...');
    const fileContent = fs.readFileSync(USER_IDS_FILE, 'utf8');
    
    // Parse the file and extract user IDs (skip comment lines starting with #)
    userIdsToProcess = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    
    console.log(`Loaded ${userIdsToProcess.length} user IDs from file`);
    return userIdsToProcess.length > 0;
  } catch (error) {
    console.error('Error loading user IDs:', error.message);
    return false;
  }
}

async function initializeWebDriver() {
  try {
    const options = new chrome.Options();
    options.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-web-security', '--disable-features=VizDisplayCompositor');
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    console.log('WebDriver initialized successfully');
  } catch (error) {
    console.error('Error initializing WebDriver:', error.message);
  }
}

async function scrapeRolimons(robloxUserId) {
  if (!driver) {
    console.error('WebDriver not initialized');
    return { value: 0, tradeAds: 0, avatarUrl: '', rolimonsUrl: `https://www.rolimons.com/player/${robloxUserId}`, isPrivate: false };
  }

  const url = `https://www.rolimons.com/player/${robloxUserId}`;
  console.log(`[Rolimons] 🌐 Navigating to Rolimons: ${url}`);
  
  try {
    await driver.get(url);
    await driver.sleep(3000);
    console.log(`[Rolimons] ✅ Successfully loaded Rolimons page for user ID: ${robloxUserId}`);

    let value = 0, tradeAds = 0, avatarUrl = '', isPrivate = false;
    
    // Parse trade ads first (always available, even for private inventories)
    try {
      const tradeAdsElem = await driver.findElement(By.css('div.my-auto.text-center.trade-ads-created-container span.card-title.mb-1.text-light.stat-data.text-nowrap'));
      const tradeAdsText = await tradeAdsElem.getText();
      tradeAds = parseInt(tradeAdsText.replace(/,/g, '')) || 0;
      console.log(`[Rolimons] 📊 Found trade ads: ${tradeAdsText} (parsed: ${tradeAds})`);
    } catch (error) {
      // Try alternative selector for trade ads
      try {
        const tradeAdsElem = await driver.findElement(By.css('span.card-title.mb-1.text-light.stat-data.text-nowrap'));
        const tradeAdsText = await tradeAdsElem.getText();
        tradeAds = parseInt(tradeAdsText.replace(/,/g, '')) || 0;
        console.log(`[Rolimons] 📊 Found trade ads (alt selector): ${tradeAdsText} (parsed: ${tradeAds})`);
      } catch (error2) {
        console.log(`[Rolimons] ❌ Could not find trade ads element: ${error.message}`);
      }
    }

    // Check for private inventory
    try {
      const privateElem = await driver.findElement(By.css('div.alert.alert-secondary.text-center.mt-3.rounded-0'));
      const privateText = await privateElem.getText();
      if (privateText.includes("This player's inventory is private")) {
        isPrivate = true;
        console.log(`[Rolimons] 🔒 Private inventory detected for user ID: ${robloxUserId}`);
      }
    } catch (error) {
      // Private inventory element not found, continue with normal parsing
    }
    
    if (!isPrivate) {
      // Parse value (only for public inventories)
      try {
        const valueElem = await driver.findElement(By.id('player_value'));
        const valueText = await valueElem.getText();
        value = parseInt(valueText.replace(/,/g, '')) || 0;
        console.log(`[Rolimons] 💰 Found value: ${valueText} (parsed: ${value})`);
      } catch (error) {
        console.log(`[Rolimons] ❌ Could not find value element: ${error.message}`);
      }
    }
    
    // Parse avatar snapshot (always try to get this)
    try {
      const avatarElem = await driver.findElement(By.css('img.mx-auto.d-block.w-100.h-100'));
      avatarUrl = await avatarElem.getAttribute('src');
      console.log(`[Rolimons] 📸 Captured avatar snapshot: ${avatarUrl}`);
    } catch (error) {
      console.log(`[Rolimons] ❌ Could not find avatar element: ${error.message}`);
    }
    
    return { value, tradeAds, avatarUrl, rolimonsUrl: url, isPrivate };
  } catch (error) {
    console.error(`[Rolimons] ❌ Error scraping Rolimons for ${robloxUserId}:`, error.message);
    return { value: 0, tradeAds: 0, avatarUrl: '', rolimonsUrl: url, isPrivate: false };
  }
}

const client = new Client({ checkUpdate: false });

let pendingLookups = new Map(); // Track pending whois responses

client.on('ready', async () => {
  console.log(`[Lookup Bot] Logged in as ${client.user.tag}`);
  
  // Load user IDs and initialize WebDriver
  const loaded = await loadUserIds();
  if (!loaded) {
    console.error('Failed to load user IDs. Exiting...');
    process.exit(1);
  }
  
  await initializeWebDriver();
  console.log(`[Lookup Bot] Bot ready! Will process ${userIdsToProcess.length} users`);
  console.log(`[Lookup Bot] Using lookup channel: ${LOOKUP_CHANNEL_ID}`);
  
  // Start processing after a short delay
  setTimeout(() => {
    processNextUser();
  }, 2000);
});

async function processNextUser() {
  if (isProcessing) return;
  if (currentIndex >= userIdsToProcess.length) {
    console.log('[Lookup Bot] All users processed! Shutting down...');
    await cleanup();
    process.exit(0);
  }

  isProcessing = true;
  const userId = userIdsToProcess[currentIndex];
  
  try {
    console.log(`[Lookup Bot] Processing user ${currentIndex + 1}/${userIdsToProcess.length}: ${userId}`);
    
    const lookupChannel = await client.channels.fetch(LOOKUP_CHANNEL_ID);
    if (!lookupChannel) {
      console.error(`[Lookup Bot] Could not find lookup channel: ${LOOKUP_CHANNEL_ID}`);
      currentIndex++;
      isProcessing = false;
      setTimeout(processNextUser, 1000);
      return;
    }

    // Store this lookup request
    pendingLookups.set(userId, {
      discordId: userId,
      timestamp: Date.now(),
      index: currentIndex
    });

    // Send the whois command
    await lookupChannel.sendSlash(BOT_ID, 'whois discord', userId);
    console.log(`[Lookup Bot] Sent /whois discord for ${userId}`);
    
    currentIndex++;
    isProcessing = false;
    
    // Wait before processing next user (to avoid rate limits)
    setTimeout(processNextUser, 5000); // 5 second delay between lookups
    
  } catch (error) {
    console.error(`[Lookup Bot] Error processing user ${userId}:`, error.message);
    currentIndex++;
    isProcessing = false;
    setTimeout(processNextUser, 2000);
  }
}

// Listen for bot responses - using the same approach as the working bot
client.on('messageCreate', async (message) => {
  // Check if this is a bot response in any of our whois channels
  if (
    message.author.id === BOT_ID &&
    WHOIS_CHANNEL_IDS.includes(message.channel.id) &&
    message.embeds &&
    message.embeds.length > 0 &&
    message.embeds[0].fields
  ) {
    let robloxUserId = '';
    for (const field of message.embeds[0].fields) {
      if (field.name.toLowerCase().includes('roblox user id')) {
        robloxUserId = field.value.replace(/`/g, '').trim();
        break;
      }
    }
    if (!robloxUserId) return;

    console.log(`[Lookup Bot] ✅ Copied user ID from RoVer embed - Roblox: ${robloxUserId}`);

    // Find the pending request that matches - check all pending (same as working bot)
    for (const [discordId, pendingLookup] of pendingLookups.entries()) {
      // Scrape Rolimons and check value
      const { value, tradeAds, avatarUrl, rolimonsUrl, isPrivate } = await scrapeRolimons(robloxUserId);
      console.log(`[Lookup Bot] Scraped - Value: ${value.toLocaleString()}, Trade Ads: ${tradeAds}, Private: ${isPrivate}`);
      
      // Handle private inventory users - send ALL to private webhook
      if (isPrivate) {
        try {
          // Get Discord user info
          let discordTag = 'Unknown';
          try {
            const user = await client.users.fetch(discordId);
            discordTag = user.tag;
          } catch {}
          
          await axios.post(PRIVATE_INV_WEBHOOK_URL, {
            content: '@everyone',
            embeds: [
              {
                title: 'Hit found',
                description: `**Discord:** ${discordId}\n**Processing:** ${pendingLookup.index + 1}/${userIdsToProcess.length}`,
                color: 0x00ff00
              },
              {
                title: 'Rolimons Info',
                description: `**Value:** Private Inventory\n**Trade Ads:** ${tradeAds}\n[Rolimons Profile](${rolimonsUrl})`,
                color: 0x00ff00,
                thumbnail: { url: avatarUrl }
              }
            ]
          });
          
          console.log(`[Lookup Bot] 🔒 Sent private inventory webhook for ${discordTag}!`);
          pendingLookups.delete(discordId);
          break;
        } catch (error) {
          console.error('Error sending private inventory webhook:', error.message);
        }
      }
      // Handle high value users (100k+)
      else if (value >= 100000) {
        try {
          // Get Discord user info
          let discordTag = 'Unknown';
          try {
            const user = await client.users.fetch(discordId);
            discordTag = user.tag;
          } catch {}
          
          await axios.post(WEBHOOK_URL, {
            content: '@everyone',
            embeds: [
              {
                title: 'Hit found',
                description: `**Discord:** ${discordId}\n**Processing:** ${pendingLookup.index + 1}/${userIdsToProcess.length}`,
                color: 0x00ff00
              },
              {
                title: 'Rolimons Info',
                description: `**Value:** ${value.toLocaleString()}\n**Trade Ads:** ${tradeAds}\n[Rolimons Profile](${rolimonsUrl})`,
                color: 0x00ff00,
                thumbnail: { url: avatarUrl }
              }
            ]
          });
          
          console.log(`[Lookup Bot] ✅ Sent webhook for ${discordTag} with value ${value.toLocaleString()}!`);
          pendingLookups.delete(discordId);
          break;
        } catch (error) {
          console.error('Error sending webhook:', error.message);
        }
      } else {
        // User has 0 value and no private inventory - skip them
        console.log(`[Lookup Bot] ⏭️ Skipping user ${discordId} - Value: ${value.toLocaleString()}, not private inventory`);
        pendingLookups.delete(discordId);
        break;
      }
    }
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

async function cleanup() {
  console.log('Cleaning up...');
  if (driver) {
    await driver.quit();
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await cleanup();
  process.exit(0);
});

// Start the bot
client.login(TOKEN).catch(error => {
  console.error('Failed to login:', error);
  process.exit(1);
});
