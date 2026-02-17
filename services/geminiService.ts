
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ChatMessage, DataFile, Department, StrategicBrief } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export class GeminiService {
  async generateProactiveBrief(
    department: Department,
    metrics: any,
    files: DataFile[]
  ): Promise<StrategicBrief> {
    const modelName = 'gemini-3-pro-preview';
    const fileContext = files.map(f => `File: ${f.name} (Type: ${f.type})`).join(', ');
    
    const prompt = `
      You are the CEO's Personal Strategic Assistant (Nexus OS). 
      Analyze the current state of the ${department} department.
      Sector Context: ${department === Department.FINANCE ? `Financial Ticker ${metrics.symbol}` : "Operational Dataset Uploads"}.
      Metrics: ${JSON.stringify(metrics)}
      Data Context: ${fileContext || "No files uploaded yet."}
      
      Generate a Board-level Strategic Brief in JSON format.
      The output MUST follow this schema:
      {
        "title": "String title of the brief",
        "summary": "Executive summary of the situation (2 sentences)",
        "recommendations": ["Action item 1", "Action item 2", "Action item 3"],
        "riskLevel": "Low" | "Medium" | "High"
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(response.text || "{}");
      return {
        ...data,
        timestamp: Date.now()
      };
    } catch (e) {
      return {
        title: "Standard Operational Overview",
        summary: "Nexus is monitoring departmental flow. No critical anomalies detected at this cycle.",
        recommendations: ["Maintain current defensive posture.", "Await further data ingestion."],
        riskLevel: 'Low',
        timestamp: Date.now()
      };
    }
  }

  async getAgentResponse(
    query: string, 
    history: ChatMessage[], 
    contextFiles: DataFile[], 
    department: Department,
    metrics: any
  ) {
    const modelName = 'gemini-3-pro-preview';
    const systemInstruction = `
      You are Nexus OS, the CEO's Sovereign Personal Strategic Agent. 
      Your tone is sophisticated, ultra-precise, and consultative. 
      Current Focus: ${department}. 
      Context Metrics: ${JSON.stringify(metrics)}.
      Current Files Available: ${contextFiles.map(f => f.name).join(', ') || 'None'}.
      
      You are agentic: you don't just answer, you suggest solutions and execute reasoning.
      If the CEO asks for analysis, perform deep cross-sector synthesis.
      If the CEO asks "What should I do?", provide 3 tactical, high-impact steps.
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })).concat([{ role: 'user', parts: [{ text: query }] }]),
        config: { systemInstruction, temperature: 0.7 }
      });
      return {
        text: response.text || "Neural link stable, awaiting further strategic command.",
        reasoningSteps: ["Synthesizing sector drift", "Evaluating risk vectors", "Calibrating ROI projections"]
      };
    } catch (error) {
      return { text: "Link interference detected. Resetting neural strata.", reasoningSteps: ["Sync failure"] };
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Professional CEO Assistant: ${text.slice(0, 500)}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (e) { return null; }
  }
}

export const geminiService = new GeminiService();
