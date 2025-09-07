import { WebSocketResponse, ProcessedPrediction } from '../types';

// Convert the raw WebSocket response predictions to a more frontend-friendly format
export const processWebSocketResponse = (
  response: WebSocketResponse
): ProcessedPrediction[] => {
  const processedPredictions: ProcessedPrediction[] = [];
  
  if (!response || !response.predictions) {
    console.warn('No predictions in response:', response);
    return processedPredictions;
  }
  
  console.log('Raw predictions from backend:', response.predictions);
  
  try {
    // Convert predictions object to array of ProcessedPrediction
    // Backend format has numeric keys: {1: [...], 2: [...]}
    Object.entries(response.predictions).forEach(([trackId, prediction]) => {
      // Backend format: [name, confidence, x1, y1, x2, y2]
      // Make sure we're handling the array correctly
      if (!Array.isArray(prediction) || prediction.length < 6) {
        console.error('Invalid prediction format:', prediction);
        return;
      }
      
      // Extract values, ensuring they're the correct type
      const [name, confidence, x1, y1, x2, y2] = prediction;
      
      // Convert coordinates to numbers and ensure they're valid
      const parsedX1 = Number(x1);
      const parsedY1 = Number(y1);
      const parsedX2 = Number(x2);
      const parsedY2 = Number(y2);
      
      // Skip invalid predictions with bad coordinates
      if (isNaN(parsedX1) || isNaN(parsedY1) || isNaN(parsedX2) || isNaN(parsedY2)) {
        console.warn('Invalid coordinates in prediction:', prediction);
        return;
      }
      
      // Make sure x2 > x1 and y2 > y1
      const normalizedX1 = Math.min(parsedX1, parsedX2);
      const normalizedY1 = Math.min(parsedY1, parsedY2);
      const normalizedX2 = Math.max(parsedX1, parsedX2);
      const normalizedY2 = Math.max(parsedY1, parsedY2);
      
      // Include all faces in the visualization
      processedPredictions.push({
        trackId: String(trackId),
        name: String(name), // Ensure it's a string
        confidence: Number(confidence), // Ensure it's a number
        x1: normalizedX1,
        y1: normalizedY1,
        x2: normalizedX2,
        y2: normalizedY2
      });
    });
    
    console.log('Processed predictions for frontend:', processedPredictions);
    return processedPredictions;
  } catch (error) {
    console.error('Error processing predictions:', error);
    return [];
  }
}; 