// Define the response types from the WebSocket
export interface Recognition {
  name: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WebSocketResponse {
  exit_ids: string[];
  predictions: {
    [trackId: string]: [
      string, // name
      number, // confidence
      number, // x1
      number, // y1
      number, // x2
      number  // y2
    ];
  };
}

// Converted prediction type for easier use in frontend
export interface ProcessedPrediction {
  trackId: string;
  name: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Exit log entry
export interface ExitLogEntry {
  names: string[];
  timestamp: string; // Displayed time string
  sortTime: number;  // Unix timestamp for sorting
} 