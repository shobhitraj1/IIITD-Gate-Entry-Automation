import { useState, useEffect, useRef, useCallback } from 'react';
import { WebSocketResponse } from '../types';

// WebSocket URL
const WS_URL = 'ws://localhost:8000/ws/frames';
const MAX_QUEUE_SIZE = 5;

/**
 * Alternative WebSocket hook that correctly sends binary data to match the Python testing script
 * 
 * Key changes:
 * 1. Using arraybuffer binary type to match Python's websocket-client implementation
 * 2. Ensuring the raw bytes are sent without additional processing
 * 3. Handling JPEG data correctly by ensuring the proper MIME typing
 */
export const useWebSocketAlternative = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<WebSocketResponse | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [lastLatency, setLastLatency] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const frameQueueRef = useRef<Blob[]>([]);
  const processingRef = useRef(false);
  const lastSentTimeRef = useRef<number | null>(null);
  const connectionAttempts = useRef(0);
  
  // Connect to WebSocket
  const connect = useCallback(() => {
    setError(null);
    connectionAttempts.current++;
    
    try {
      console.log(`Attempting to connect to WebSocket (${connectionAttempts.current})...`);
      console.log(`WebSocket URL: ${WS_URL}`);
      
      if (wsRef.current) {
        console.log('Closing existing WebSocket connection...');
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Create new WebSocket connection
      wsRef.current = new WebSocket(WS_URL);
      
      // Set binary type to arraybuffer to match Python's websocket-client
      if (wsRef.current) {
        console.log('Setting binaryType to arraybuffer');
        wsRef.current.binaryType = 'arraybuffer';
      }
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setIsConnected(true);
        setError(null);
        connectionAttempts.current = 0;
        
        // Process any queued frames when connection is established
        processNextFrame();
      };
      
      wsRef.current.onclose = (event) => {
        console.log(`❌ WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none provided'})`);
        setIsConnected(false);
        processingRef.current = false;
        
        // Try to reconnect after a delay that increases with each attempt
        const delay = Math.min(2000 * Math.pow(1.5, Math.min(connectionAttempts.current, 10)), 30000);
        console.log(`Will attempt to reconnect in ${delay}ms`);
        
        setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
            connect();
          }
        }, delay);
      };
      
      wsRef.current.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError(`Failed to connect to server: ${(event as any).message || 'Unknown error'}`);
        processingRef.current = false;
      };
      
      wsRef.current.onmessage = (event) => {
        console.log(`📩 Received message:`, event.data);
        processingRef.current = false;
        
        // Calculate latency if we sent a frame
        if (lastSentTimeRef.current !== null) {
          const latency = performance.now() - lastSentTimeRef.current;
          setLastLatency(latency);
          console.log(`Round-trip latency: ${latency.toFixed(2)}ms`);
          lastSentTimeRef.current = null;
        }
        
        try {
          // Parse JSON response
          const data = JSON.parse(event.data);
          
          // Detailed debug of the response format
          console.log('Parsed response data:', data);
          
          if (data && data.predictions) {
            console.log('Response contains predictions:', data.predictions);
            console.log('Keys in predictions:', Object.keys(data.predictions));
            
            // Sample the first prediction to see format
            const firstPredKey = Object.keys(data.predictions)[0];
            if (firstPredKey) {
              console.log(`First prediction (key=${firstPredKey}):`, data.predictions[firstPredKey]);
            }
          } else {
            console.warn('Response missing predictions property');
          }
          
          setLastResponse(data);
          
          // Process next frame immediately after receiving a response
          // This ensures we send frames as fast as the server can process them
          processNextFrame();
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };
    } catch (err) {
      console.error('Failed to connect to WebSocket:', err);
      setError(`Failed to connect to server: ${(err as any).message || 'Unknown error'}`);
    }
  }, []);
  
  // Process the next frame in the queue
  const processNextFrame = useCallback(() => {
    if (
      !isConnected || 
      processingRef.current || 
      !frameQueueRef.current.length || 
      !wsRef.current || 
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      if (!isConnected) console.log('Not processing frame: Not connected');
      if (processingRef.current) console.log('Not processing frame: Already processing');
      if (!frameQueueRef.current.length) console.log('Not processing frame: Queue empty');
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) console.log('Not processing frame: WebSocket not ready');
      return;
    }
    
    processingRef.current = true;
    const nextFrame = frameQueueRef.current.shift();
    setQueueSize(frameQueueRef.current.length);
    
    if (nextFrame) {
      try {
        console.log(`📤 Processing frame: ${nextFrame.size} bytes, type: ${nextFrame.type}`);
        lastSentTimeRef.current = performance.now();
        
        // CRITICAL FIX: We need to read the blob as ArrayBuffer first
        const reader = new FileReader();
        
        reader.onload = function() {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not ready when trying to send frame');
            processingRef.current = false;
            lastSentTimeRef.current = null;
            return;
          }
          
          try {
            const arrayBuffer = reader.result as ArrayBuffer;
            
            // Verify we have valid data
            const dataView = new DataView(arrayBuffer);
            
            // Check if this looks like a JPEG (starts with FF D8)
            if (arrayBuffer.byteLength >= 2 && 
                dataView.getUint8(0) === 0xFF && 
                dataView.getUint8(1) === 0xD8) {
              console.log('✅ Valid JPEG signature detected');
            } else {
              console.warn('⚠️ Warning: Data does not appear to have JPEG signature!');
              console.log(`First bytes: ${new Uint8Array(arrayBuffer.slice(0, 10))}`);
            }
            
            console.log(`Sending ${arrayBuffer.byteLength} bytes...`);
            wsRef.current.send(arrayBuffer);
            console.log('Frame sent successfully!');
          } catch (e) {
            console.error('Error sending frame:', e);
            processingRef.current = false;
            lastSentTimeRef.current = null;
          }
        };
        
        reader.onerror = function() {
          console.error('Error reading blob');
          processingRef.current = false;
          lastSentTimeRef.current = null;
        };
        
        // Read as ArrayBuffer to match Python's buf.tobytes()
        reader.readAsArrayBuffer(nextFrame);
      } catch (e) {
        console.error('Error processing frame:', e);
        setError(`Error processing frame: ${(e as any).message || 'Unknown error'}`);
        processingRef.current = false;
        lastSentTimeRef.current = null;
      }
    } else {
      processingRef.current = false;
    }
  }, [isConnected]);
  
  // Queue a new frame for processing
  const queueFrame = useCallback((frameBlob: Blob) => {
    console.log(`Queueing frame: ${frameBlob.size} bytes, type: ${frameBlob.type}`);
    
    // If queue is full, remove oldest frame
    while (frameQueueRef.current.length >= MAX_QUEUE_SIZE) {
      console.log('Queue full, dropping oldest frame');
      frameQueueRef.current.shift();
    }
    
    // Ensure correct MIME type - this is important for proper handling
    let processedBlob = frameBlob;
    
    // If the blob doesn't have the correct MIME type, create a new one with the right type
    if (frameBlob.type !== 'image/jpeg') {
      console.warn(`Converting blob MIME type from ${frameBlob.type} to image/jpeg`);
      processedBlob = new Blob([frameBlob], { type: 'image/jpeg' });
    }
    
    frameQueueRef.current.push(processedBlob);
    setQueueSize(frameQueueRef.current.length);
    console.log(`Frame queued, queue size: ${frameQueueRef.current.length}`);
    
    // Only process next frame if not already processing
    if (!processingRef.current && isConnected) {
      processNextFrame();
    } else {
      if (!isConnected) console.log('Not processing: Not connected');
      if (processingRef.current) console.log('Not processing: Already processing');
    }
  }, [isConnected, processNextFrame]);
  
  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    
    return () => {
      console.log('Cleaning up WebSocket connection');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
  
  // Helper to handle manual reconnection
  const reconnect = useCallback(() => {
    console.log('Manual reconnection requested');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);
  
  // Return status and methods for the component
  return {
    isConnected,
    error,
    lastResponse,
    queueFrame,
    reconnect,
    queueSize,
    lastLatency
  };
}; 