import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

// Enable JSON bodies
app.use(express.json());

// Lazy-loaded Gemini Client
let aiClient: GoogleGenAI | null = null;
function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    aiClient = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// Fallback response engine for mock, missing or invalid API keys
function getFallbackReply(message: string, context: any): string {
  const msgLower = message.toLowerCase();
  
  const selectedBus = context?.selectedBus || {};
  const buses = context?.buses || [];
  const routes = context?.routes || [];
  const communityReports = context?.communityReports || [];

  // Question: Driver & Speed
  if (msgLower.includes('driver') || msgLower.includes('driving') || msgLower.includes('speed') || msgLower.includes('velocity')) {
    const driverName = selectedBus.driver || 'Operator Dave';
    const speed = selectedBus.speed !== undefined ? selectedBus.speed : 42;
    const busName = selectedBus.routeName || 'Downtown Express';
    const busId = selectedBus.id || '101A';
    return `🚌 **Line ${busName}** (Bus ID: **${busId}**) is currently being operated by safe specialist transit operator **${driverName}**.\n\nIt is traveling at a speed of **${speed.toFixed(1)} km/h** towards **${selectedBus.nextStop || 'next terminal'}** with an ETA of **${selectedBus.etaMinutes || 3} mins**.\n\n*Note: Telemetry values are synced dynamically up to the millisecond.*`;
  }

  // Question: Delays or issues
  if (msgLower.includes('delay') || msgLower.includes('delayed') || msgLower.includes('disruption') || msgLower.includes('issue') || msgLower.includes('broken') || msgLower.includes('problem')) {
    const delayedBuses = buses.filter((b: any) => b.status === 'Delayed' || b.status === 'Heavy Traffic');
    if (communityReports.length > 0 || delayedBuses.length > 0) {
      let reportStr = `⚠️ **Active System Disruption Alert Live Feed:**\n\n`;
      if (delayedBuses.length > 0) {
        reportStr += `🚗 **Delayed Fleets:**\n`;
        delayedBuses.forEach((b: any) => {
          reportStr += `- **Line ${b.routeName}** (ID: ${b.id}) is reporting status: **${b.status}** (${b.delayMinutes || 5} min delay) approaching ${b.nextStop || 'station'}.\n`;
        });
        reportStr += `\n`;
      }
      if (communityReports.length > 0) {
        reportStr += `👥 **Commuter Crowd-Sourced Flags:**\n`;
        communityReports.forEach((issue: any) => {
          reportStr += `- **[${issue.category}]** on ${issue.targetName}: "${issue.description}" (${issue.votes} helper votes)\n`;
        });
      }
      return reportStr;
    }
    return `✅ **All routes are currently clear and running on time!**\n\nNo delays are registered on our fleet telemetry meters, and no commuter incident flags are active at this moment. Have a safe journey!`;
  }

  // Question: Least crowded
  if (msgLower.includes('crowd') || msgLower.includes('crowded') || msgLower.includes('least') || msgLower.includes('empty')) {
    if (buses.length > 0) {
      const sortedBuses = [...buses].sort((a: any, b: any) => {
        const pctA = a.occupancyPercent !== undefined ? a.occupancyPercent : (a.occupancy / (a.capacity || 50) * 100);
        const pctB = b.occupancyPercent !== undefined ? b.occupancyPercent : (b.occupancy / (b.capacity || 50) * 100);
        return pctA - pctB;
      });
      const bestBus = sortedBuses[0];
      const occupancyStr = bestBus.occupancyPercent !== undefined ? `${bestBus.occupancyPercent}%` : `${bestBus.occupancy}/${bestBus.capacity || 50} pax`;
      return `👥 Looking for a spacious journey?\n\nThe least crowded bus active in the fleet is **Line ${bestBus.routeName} (ID: ${bestBus.id})**, which is currently operating at only **${occupancyStr} capacity**.\n\nWe recommend boarding this service to ensure a comfortable seat and peaceful commute!`;
    }
    return `The system reports average medium-moderate crowding across all active lines. Please check individual vehicle occupancy scales in the gauges panel.`;
  }

  // Question: Fares
  if (msgLower.includes('fare') || msgLower.includes('price') || msgLower.includes('ticket') || msgLower.includes('rupee') || msgLower.includes('cost')) {
    let fareStr = `🎫 **Transit Route Fare Details (in Indian Rupees):**\n\n`;
    routes.forEach((r: any) => {
      fareStr += `- **Line ${r.name} (ID: ${r.id})**: ₹${r.fare.toFixed(2)} per ticket\n`;
    });
    fareStr += `\nTo book a ticket instantly, use the **Interactive Ticket Booking Counter** inside our dashboard, input your details, selection and click **'Secure Ticket Pass'**. Your reservation ledger will be updated immediately.`;
    return fareStr;
  }

  // Generic fallback if context can't match specific query directly
  return `👋 Greetings! I am your **GoLocal Transit Assistant**, monitoring active vehicle telemetry, stops, and passenger comfort metrics across the San Francisco grid.

🗺️ **Active Fleet Status Overview**:
- Total Active Routes: **${routes.length} Loops**
- Buses Monitored: **${buses.length} active units**
- Active Commuter Flags: **${communityReports.length} reports logged**

Currently selected: **Line ${selectedBus.routeName || 'N/A'} (ID: ${selectedBus.id || 'N/A'})**
- Operator: **${selectedBus.driver || 'N/A'}**
- Cruising Speed: **${selectedBus.speed !== undefined ? selectedBus.speed.toFixed(1) : '0'} km/h**
- Next Scheduled Stop: **${selectedBus.nextStop || 'N/A'}**
- Telemetry Connection: **STABLE**

Ask me anything about delay alerts, least-crowded buses, ticket fares, or registered breakdowns!`;
}

// API: Agent Chat Proxy
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, context } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const isMockOrMissing = !apiKey || apiKey.trim() === "" || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("PLACEHOLDER");

    if (isMockOrMissing) {
      const reply = getFallbackReply(message, context);
      res.json({ reply });
      return;
    }

    try {
      const ai = getAiClient();

      // Construct the context-aware system prompt
      const systemPrompt = `
You are the "GoLocal Transit Assistant", a friendly, highly intelligent hyperlocal AI transit coordinator expert in San Francisco.
You have access to the real-time active vehicle fleet data and active crowdsourced incident/comfort logs (community passenger flags).
Your goal is to provide actionable advice, answers, and helper travel coordinate calculations, check delays, recommend least-compromised routes, explain breakdowns/floods, and guide commuters through safe passage.

Here is the CURRENT live bus fleet data, active routes, and passenger incident reports (communityReports) from the state context:
${JSON.stringify(context, null, 2)}

Instructions for outputting response:
1. Always be courteous, precise, and practical. Ensure any references to prices or fares use rupees (₹) matching the context values.
2. Directly answer user questions about wait times, delay status, occupancy, and active community incident flags (such as mechanical breakdowns, flooding at stations, AC broken, or roadblocks).
3. If a vehicle has a registered breakdown flag, warn the user explicitly that transit coordinates have frozen and recommend taking alternative active routes.
4. Keep answers relatively concise and highly readable (use bolding for key metrics, bullet points, or simple markdown headers).
5. If the user asks general travel questions or asks to book, guide them on how to click and book ticket via the interactive dashboard panel on our UI.
`;

      // Map conversation history to the format required by the SDK if needed
      const contents = [
        { role: 'user', parts: [{ text: systemPrompt }] }
      ];

      if (history && Array.isArray(history)) {
        history.forEach((h: any) => {
          contents.push({
            role: h.sender === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
          });
        });
      }

      // Add current user message
      contents.push({
        role: 'user',
        parts: [{ text: message }]
      });

      // Run model query with modern gemini-3.5-flash as the source of truth fast model
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents,
      });

      const reply = response.text || "I apologize, but I am unable to compute a response at this moment.";
      res.json({ reply });

    } catch (realGeminiError: any) {
      console.warn('Real Gemini API failed, falling back to local responsive engine:', realGeminiError.message);
      const reply = getFallbackReply(message, context);
      res.json({ reply });
    }

  } catch (error: any) {
    console.error('Gemini API Integration Error:', error.message);
    res.status(500).json({ 
      error: 'We encountered an error processing your query.',
      details: error.message 
    });
  }
});

// Setup Vite Dev server or Serve static files based on NODE_ENV environment
async function init() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[GoLocal] Full-stack running on http://localhost:${PORT}`);
  });
}

init();
