import { useState, useEffect, useRef, useCallback } from 'react';
import { WebSocketResponse } from '../types';

// Make sure the URL matches your backend exactly - include any needed path components
const WS_URL = 'ws://localhost:8000/ws/frames';
const MAX_QUEUE_SIZE = 5;

export const useWebSocket = () => {
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
      
      // Close any existing connection
      if (wsRef.current) {
        console.log('Closing existing WebSocket connection...');
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Create new WebSocket connection
      wsRef.current = new WebSocket(WS_URL);
      
      // Set binary type to arraybuffer for proper binary transmission
      if (wsRef.current) {
        console.log('Setting binaryType to arraybuffer');
        wsRef.current.binaryType = 'arraybuffer';
      }
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setIsConnected(true);
        setError(null);
        connectionAttempts.current = 0;
        
        // Send a test message to verify the connection is properly established
        try {
          const testData = new Uint8Array([0, 1, 2, 3, 4]);
          console.log('Sending test data to verify connection...');
          wsRef.current?.send(testData.buffer);
        } catch (err) {
          console.error('Error sending test data:', err);
        }
        
        // Process any queued frames when connection is established
        processNextFrame();
      };
      
      wsRef.current.onclose = (event) => {
        console.log(`❌ WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none provided'})`);
        setIsConnected(false);
        processingRef.current = false;
        
        // Try to reconnect after a delay that increases with each attempt (up to 30 seconds)
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
          // Handle different message formats
          let data: WebSocketResponse;
          
          if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else if (event.data instanceof Blob) {
            // If the backend responds with a blob
            console.log('Received blob data, converting to text');
            const reader = new FileReader();
            reader.onload = function() {
              try {
                const text = reader.result as string;
                const jsonData = JSON.parse(text);
                setLastResponse(jsonData);
              } catch (err) {
                console.error('Error parsing blob data:', err);
              }
            };
            reader.readAsText(event.data);
            return;
          } else {
            console.log('Received non-string data:', event.data);
            // For ArrayBuffer or other formats
            const decoder = new TextDecoder();
            const text = decoder.decode(event.data);
            data = JSON.parse(text);
          }
          
          console.log('Parsed response:', data);
          setLastResponse(data);
          
          // Process next frame after receiving a response
          setTimeout(() => processNextFrame(), 0);
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
      // Record the time we send the frame for latency calculation
      lastSentTimeRef.current = performance.now();
      
      // Convert Blob to ArrayBuffer before sending
      const reader = new FileReader();
      reader.onload = function() {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            const arrayBuffer = reader.result as ArrayBuffer;
            console.log(`📤 Sending frame: ${nextFrame.size} bytes`);
            
            wsRef.current.send(arrayBuffer);
            console.log('Frame sent successfully');
          } catch (e) {
            console.error('Error sending frame:', e);
            setError(`Error sending frame: ${(e as any).message || 'Unknown error'}`);
            processingRef.current = false;
            lastSentTimeRef.current = null;
          }
        } else {
          console.log('WebSocket not ready when trying to send frame');
          processingRef.current = false;
          lastSentTimeRef.current = null;
        }
      };
      
      reader.onerror = function(event) {
        console.error('Error reading blob:', event);
        setError(`Error reading blob: ${(event.target as any)?.error?.message || 'Unknown error'}`);
        processingRef.current = false;
        lastSentTimeRef.current = null;
      };
      
      console.log('Reading blob as ArrayBuffer...');
      reader.readAsArrayBuffer(nextFrame);
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
    
    frameQueueRef.current.push(frameBlob);
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