import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';

interface WebSocketTestProps {
  wsUrl: string;
}

const WebSocketTest: React.FC<WebSocketTestProps> = ({ wsUrl }) => {
  const [status, setStatus] = useState<string>('Disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [testData, setTestData] = useState<string>('Hello Server');
  
  const wsRef = useRef<WebSocket | null>(null);
  
  // Add log with timestamp
  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().substr(11, 12);
    setLogs(prev => [`${timestamp} - ${message}`, ...prev].slice(0, 100));
  };
  
  // Connect to WebSocket
  const connect = () => {
    try {
      addLog(`Connecting to ${wsUrl}...`);
      setStatus('Connecting...');
      
      // Close existing connection if any
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // Set to binary type for testing both formats
      ws.binaryType = 'arraybuffer';
      
      ws.onopen = () => {
        addLog('✅ WebSocket connected successfully');
        setStatus('Connected');
        setConnected(true);
      };
      
      ws.onclose = (event) => {
        addLog(`❌ WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
        setStatus('Disconnected');
        setConnected(false);
      };
      
      ws.onerror = (event) => {
        addLog(`⚠️ WebSocket error: ${(event as any).message || 'unknown error'}`);
        setStatus('Error');
      };
      
      ws.onmessage = (event) => {
        let dataStr: string;
        
        if (typeof event.data === 'string') {
          dataStr = event.data.substring(0, 100); // Limit length
        } else if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          dataStr = `ArrayBuffer [${bytes.length} bytes]: ${Array.from(bytes.slice(0, 20)).join(',')}...`;
        } else if (event.data instanceof Blob) {
          dataStr = `Blob [${event.data.size} bytes]`;
        } else {
          dataStr = String(event.data);
        }
        
        addLog(`📩 Received: ${dataStr}`);
      };
    } catch (error) {
      addLog(`Failed to connect: ${error}`);
      setStatus('Connection Failed');
    }
  };
  
  // Disconnect WebSocket
  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      addLog('Manual disconnect');
    }
  };
  
  // Send text data
  const sendText = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(testData);
        addLog(`📤 Sent text: ${testData}`);
      } catch (error) {
        addLog(`Error sending text: ${error}`);
      }
    } else {
      addLog('Cannot send: WebSocket not connected');
    }
  };
  
  // Send binary data
  const sendBinary = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        // Create a simple binary message (a random array of bytes)
        const data = new Uint8Array(20);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.floor(Math.random() * 256);
        }
        
        wsRef.current.send(data.buffer);
        addLog(`📤 Sent binary: [${data.length} bytes]`);
      } catch (error) {
        addLog(`Error sending binary: ${error}`);
      }
    } else {
      addLog('Cannot send: WebSocket not connected');
    }
  };
  
  // Send a JPEG test image
  const sendTestImage = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        // Create a canvas with a simple colored rectangle
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Draw a gradient background
          const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
          gradient.addColorStop(0, 'blue');
          gradient.addColorStop(1, 'green');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Add text
          ctx.fillStyle = 'white';
          ctx.font = '20px Arial';
          ctx.fillText('Test Frame', 20, 30);
          ctx.fillText(new Date().toISOString(), 20, 60);
          
          // Convert to JPEG blob
          canvas.toBlob((blob) => {
            if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              // Convert Blob to ArrayBuffer for sending
              const reader = new FileReader();
              reader.onload = () => {
                if (reader.result instanceof ArrayBuffer && wsRef.current) {
                  wsRef.current.send(reader.result);
                  addLog(`📤 Sent test image: ${blob.size} bytes`);
                }
              };
              reader.onerror = () => {
                addLog('Error reading test image blob');
              };
              reader.readAsArrayBuffer(blob);
            }
          }, 'image/jpeg', 0.8);
        }
      } catch (error) {
        addLog(`Error creating/sending test image: ${error}`);
      }
    } else {
      addLog('Cannot send: WebSocket not connected');
    }
  };
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
  
  return (
    <Container>
      <h2>WebSocket Test Tool</h2>
      
      <StatusBar>
        <StatusIndicator connected={connected} />
        <span>{status}</span>
        <span>URL: {wsUrl}</span>
      </StatusBar>
      
      <ControlPanel>
        <ButtonGroup>
          <Button onClick={connect} disabled={connected}>Connect</Button>
          <Button onClick={disconnect} disabled={!connected}>Disconnect</Button>
        </ButtonGroup>
        
        <TestDataGroup>
          <input
            type="text"
            value={testData}
            onChange={(e) => setTestData(e.target.value)}
            placeholder="Test data to send"
          />
          <Button onClick={sendText} disabled={!connected}>Send Text</Button>
          <Button onClick={sendBinary} disabled={!connected}>Send Binary</Button>
          <Button onClick={sendTestImage} disabled={!connected}>Send Test Image</Button>
        </TestDataGroup>
      </ControlPanel>
      
      <LogsContainer>
        <h3>Communication Logs</h3>
        <LogsList>
          {logs.map((log, index) => (
            <LogEntry key={index}>{log}</LogEntry>
          ))}
        </LogsList>
      </LogsContainer>
    </Container>
  );
};

const Container = styled.div`
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 20px;
  margin-bottom: 20px;
  
  h2 {
    margin-top: 0;
    margin-bottom: 15px;
  }
`;

const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
  font-family: monospace;
`;

interface StatusIndicatorProps {
  connected: boolean;
}

const StatusIndicator = styled.div<StatusIndicatorProps>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: ${props => props.connected ? '#28a745' : '#dc3545'};
`;

const ControlPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 10px;
`;

const TestDataGroup = styled.div`
  display: flex;
  gap: 10px;
  
  input {
    flex: 1;
    padding: 8px;
    border: 1px solid #ced4da;
    border-radius: 4px;
  }
`;

const Button = styled.button`
  padding: 8px 16px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  
  &:hover {
    background-color: #0069d9;
  }
  
  &:disabled {
    background-color: #6c757d;
    cursor: not-allowed;
  }
`;

const LogsContainer = styled.div`
  h3 {
    margin-top: 0;
    margin-bottom: 10px;
  }
`;

const LogsList = styled.div`
  height: 300px;
  overflow-y: auto;
  background-color: #212529;
  color: #f8f9fa;
  border-radius: 4px;
  padding: 10px;
  font-family: monospace;
  font-size: 14px;
`;

const LogEntry = styled.div`
  margin-bottom: 5px;
  
  &:hover {
    background-color: #343a40;
  }
`;

export default WebSocketTest; 