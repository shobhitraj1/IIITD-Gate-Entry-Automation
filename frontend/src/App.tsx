import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import VideoInput from './components/VideoInput';
import CanvasOverlay from './components/CanvasOverlay';
import ExitLog from './components/ExitLog';
import WebSocketTest from './components/WebSocketTest';
import { useWebSocketAlternative as useWebSocket } from './hooks/useWebSocketAlternative';
import { processWebSocketResponse } from './utils/processResponse';
import { ProcessedPrediction, ExitLogEntry } from './types';

// WebSocket URL - make sure this matches your backend
const WS_URL = 'ws://localhost:8000/ws/frames';
// Use relative URL for API endpoints to support mobile devices on the same network
const API_URL = window.location.hostname === '<redacted>' 
  ? 'http://<redacted>:8000'  // Development on same network
  : window.location.protocol + '//' + window.location.hostname + ':8000'; // Production/mobile support

interface ConnectionStatusProps {
  connected: boolean;
}

interface DebugButtonProps {
  active: boolean;
}

const App: React.FC = () => {
  const [predictions, setPredictions] = useState<ProcessedPrediction[]>([]);
  const [exitLog, setExitLog] = useState<ExitLogEntry[]>([]);
  const [stats, setStats] = useState({
    fps: 0,
    pendingFrames: 0,
    latency: 0,
    detections: 0
  });
  const [showTestTools, setShowTestTools] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Track exit IDs that have already been displayed to prevent duplicates
  const [processedExitIds, setProcessedExitIds] = useState<Set<string>>(new Set());
  
  const { 
    isConnected, 
    error, 
    lastResponse, 
    queueFrame, 
    reconnect,
    queueSize,
    lastLatency 
  } = useWebSocket();
  
  // Fetch all exits from the backend
  const fetchAllExits = useCallback(async () => {
    try {
      // Set loading state but don't show the banner
      setIsLoading(true);
      
      console.log(`Fetching exits from: ${API_URL}/get_all_exits`);
      const response = await fetch(`${API_URL}/get_all_exits`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Received exit data:', data);
      
      // Process the received exits
      if (data && data.exits && Array.isArray(data.exits)) {
        setExitLog(prevLog => {
          // Create a map of existing entries
          const existingEntries = new Set(
            prevLog.map(entry => {
              // Create a unique identifier for each entry
              return entry.names.sort().join(',') + '-' + entry.sortTime;
            })
          );
          
          // Process new entries
          const newEntries: ExitLogEntry[] = [];
          
          data.exits.forEach((exit: [string, string]) => {
            const [name, timestamp] = exit;
            
            // Convert backend timestamp to Date object
            const exitDate = new Date(timestamp);
            const sortTime = exitDate.getTime();
            const displayTime = exitDate.toLocaleTimeString();
            
            // Create a unique identifier for this exit
            const exitId = [name].sort().join(',') + '-' + sortTime;
            
            // Only add if not already in the log
            if (!existingEntries.has(exitId)) {
              existingEntries.add(exitId);
              newEntries.push({
                names: [name],
                timestamp: displayTime,
                sortTime
              });
            }
          });
          
          // Combine with existing entries and limit to 50 to prevent the list from growing too large
          const combinedEntries = [...newEntries, ...prevLog].slice(0, 50);
          return combinedEntries;
        });
      }
    } catch (error) {
      console.error('Error fetching all exits:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Fetch exits on component mount
  useEffect(() => {
    // Fetch exits when component mounts
    fetchAllExits();
    
    // Set up interval to refresh exits
    const intervalId = setInterval(() => {
      fetchAllExits();
    }, 60000); // Refresh every 60 seconds
    
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchAllExits]);
  
  // Update stats every second
  useEffect(() => {
    const interval = setInterval(() => {
      setStats({
        fps: Math.round(lastLatency ? 1000 / lastLatency : 0),
        pendingFrames: queueSize,
        latency: lastLatency,
        detections: predictions.length
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [lastLatency, queueSize, predictions.length]);
  
  // Handle incoming WebSocket responses
  useEffect(() => {
    if (!lastResponse) return;
    
    // Process predictions
    const processedPredictions = processWebSocketResponse(lastResponse);
    setPredictions(processedPredictions);
    
    // Add to exit log if there are exits
    if (lastResponse.exit_ids && lastResponse.exit_ids.length > 0) {
      setExitLog(prevLog => {
        // Create a set of existing entry identifiers
        const existingEntries = new Set(
          prevLog.map(entry => {
            // Create a unique identifier for each entry
            return entry.names.sort().join(',') + '-' + entry.sortTime;
          })
        );
        
        // Create a new entry
        const now = new Date();
        const timestamp = now.toLocaleTimeString();
        const sortTime = now.getTime();
        
        // Create a unique identifier for the new entry
        const newEntryId = lastResponse.exit_ids.sort().join(',') + '-' + sortTime;
        
        // Only add if this exact entry doesn't already exist
        if (!existingEntries.has(newEntryId)) {
          const newExitEntry: ExitLogEntry = {
            names: lastResponse.exit_ids,
            timestamp,
            sortTime
          };
          
          // Add to the existing log, keeping only last 20 entries
          return [newExitEntry, ...prevLog].slice(0, 20);
        }
        
        return prevLog;
      });
    }
  }, [lastResponse]);
  
  // Handle frames from VideoInput
  const handleFrame = useCallback((frameBlob: Blob) => {
    if (isConnected) {
      queueFrame(frameBlob);
    }
  }, [queueFrame, isConnected]);
  
  // Fetch exits from the backend when video is stopped
  const handleVideoStop = useCallback(async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`${API_URL}/get_exits`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Process the received exits
      if (data && data.exits && Array.isArray(data.exits) && data.exits.length > 0) {
        // Get current entries
        setExitLog(prevLog => {
          // Create a set of existing entry identifiers
          const existingEntries = new Set(
            prevLog.map(entry => {
              // Create a unique identifier for each entry
              return entry.names.sort().join(',') + '-' + entry.sortTime;
            })
          );
          
          // Create a new entry
          const now = new Date();
          const timestamp = now.toLocaleTimeString();
          const sortTime = now.getTime();
          
          // Create a unique identifier for the new entry
          const newEntryId = data.exits.sort().join(',') + '-' + sortTime;
          
          // Only add if this exact entry doesn't already exist
          if (!existingEntries.has(newEntryId)) {
            const newExitEntry: ExitLogEntry = {
              names: data.exits,
              timestamp,
              sortTime
            };
            
            // Add to the existing log, keeping only last 20 entries
            return [newExitEntry, ...prevLog].slice(0, 20);
          }
          
          return prevLog;
        });
      }
    } catch (error) {
      console.error('Error fetching exits:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Add a button to load all exits
  const handleLoadAllExits = useCallback(() => {
    fetchAllExits();
  }, [fetchAllExits]);
  
  return (
    <Container>
      <Header>
        <Title>Face Recognition System</Title>
        
        <HeaderControls>
          <ConnectionStatus connected={isConnected}>
            {isConnected ? 'Connected to Server' : 'Disconnected'}
          </ConnectionStatus>
          
          <DebugButton 
            onClick={() => setShowTestTools(!showTestTools)}
            active={showTestTools}
          >
            {showTestTools ? 'Hide Test Tools' : 'Show Test Tools'}
          </DebugButton>
        </HeaderControls>
      </Header>
      
      {error && (
        <ErrorBanner>
          <ErrorMessage>{error}</ErrorMessage>
          <ReconnectButton onClick={reconnect}>
            Reconnect
          </ReconnectButton>
        </ErrorBanner>
      )}
      
      {showTestTools && (
        <WebSocketTest wsUrl={WS_URL} />
      )}
      
      <ContentGrid>
        <MainContent>
          <VideoSection>
            <VideoAndOverlayContainer className="VideoAndOverlayContainer">
              <VideoInput onFrame={handleFrame} onStop={handleVideoStop} />
              <CanvasOverlay predictions={predictions} />
            </VideoAndOverlayContainer>
            <StatsDisplay>
              <div>FPS: {stats.fps}</div>
              <div>Queue: {stats.pendingFrames}</div>
              <div>Latency: {stats.latency.toFixed(0)}ms</div>
              <div>Faces: {stats.detections}</div>
            </StatsDisplay>
          </VideoSection>
        </MainContent>
        
        <Sidebar>
          <ExitLog entries={exitLog} />
        </Sidebar>
      </ContentGrid>
    </Container>
  );
};

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
`;

const HeaderControls = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`;

const Title = styled.h1`
  font-size: 24px;
  margin: 0;
`;

const ConnectionStatus = styled.div<ConnectionStatusProps>`
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  background-color: ${(props: ConnectionStatusProps) => props.connected ? '#2ecc71' : '#e74c3c'};
  color: white;
`;

const DebugButton = styled.button<DebugButtonProps>`
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  background-color: ${(props: DebugButtonProps) => props.active ? '#17a2b8' : '#6c757d'};
  color: white;
  border: none;
  cursor: pointer;
  
  &:hover {
    background-color: ${(props: DebugButtonProps) => props.active ? '#138496' : '#5a6268'};
  }
`;

const ErrorBanner = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #f8d7da;
  color: #721c24;
  padding: 10px 15px;
  border-radius: 4px;
  margin-bottom: 20px;
`;

const ErrorMessage = styled.div`
  flex: 1;
`;

const ReconnectButton = styled.button`
  background-color: #0275d8;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
`;

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const MainContent = styled.div``;

const Sidebar = styled.div``;

const VideoAndOverlayContainer = styled.div`
  position: relative;
  width: 100%;
  display: block;
  margin: 0 auto;
  max-width: 100%;
  overflow: hidden;
`;

const VideoSection = styled.div`
  position: relative;
  width: 100%;
  max-width: 100%;
  overflow: visible;
  margin-bottom: 20px;
`;

const StatsDisplay = styled.div`
  position: absolute;
  bottom: 10px;
  right: 10px;
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 20;
`;

const ExitLogControls = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
`;

const LoadExitsButton = styled.button`
  padding: 6px 12px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  
  &:hover {
    background-color: #0069d9;
  }
  
  &:disabled {
    background-color: #6c757d;
    cursor: not-allowed;
  }
`;

export default App; 