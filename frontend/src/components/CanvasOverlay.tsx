import React, { useRef, useEffect, useState } from 'react';
import styled from 'styled-components';
import { ProcessedPrediction } from '../types';

interface CanvasOverlayProps {
  predictions: ProcessedPrediction[];
}

interface ScaleFactor {
  x: number;
  y: number;
}

interface Position {
  top: number;
  left: number;
}

// Generate a consistent color based on track ID
const getTrackColor = (trackId: string, isUnknown: boolean): string => {
  if (isUnknown) {
    return 'rgba(200, 200, 200, 0.8)'; // Gray color for unknown faces
  }
  
  // Simple hash function to generate a color from the track ID
  const hash = trackId.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  
  // Get a hue value between 0-360 from the hash
  const hue = hash % 360;
  
  // Return HSL color with fixed saturation and lightness
  return `hsl(${hue}, 80%, 60%)`;
};

const CanvasOverlay: React.FC<CanvasOverlayProps> = ({ predictions }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scaleFactor, setScaleFactor] = useState<ScaleFactor>({ x: 1, y: 1 });
  const [videoRect, setVideoRect] = useState<DOMRect | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  
  // Setup observer to watch for video element
  useEffect(() => {
    const findVideoElement = () => {
      if (!containerRef.current) return;
      
      // Find the video element - looking for it directly in the VideoAndOverlayContainer
      const parentContainer = containerRef.current.closest('.VideoAndOverlayContainer');
      if (!parentContainer) return;
      
      const videoContainer = parentContainer.querySelector('.VideoContainer');
      if (!videoContainer) return;
      
      const foundVideo = videoContainer.querySelector('video');
      if (!foundVideo) return;
      
      if (foundVideo !== videoElement) {
        setVideoElement(foundVideo);
        
        // Add listeners for video events
        foundVideo.addEventListener('loadedmetadata', updateCanvasDimensions);
        foundVideo.addEventListener('resize', updateCanvasDimensions);
        foundVideo.addEventListener('play', updateCanvasDimensions);
        
        // Force an immediate update
        setTimeout(updateCanvasDimensions, 100);
      }
    };
    
    // Initial check
    findVideoElement();
    
    // Create a mutation observer to watch for changes
    const observer = new MutationObserver(findVideoElement);
    
    // Start observing
    if (containerRef.current) {
      const rootElement = containerRef.current.closest('.VideoAndOverlayContainer') || document.body;
      observer.observe(rootElement, { 
        childList: true, 
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
    
    return () => {
      // Clean up listeners
      observer.disconnect();
      if (videoElement) {
        videoElement.removeEventListener('loadedmetadata', updateCanvasDimensions);
        videoElement.removeEventListener('resize', updateCanvasDimensions);
        videoElement.removeEventListener('play', updateCanvasDimensions);
      }
    };
  }, [videoElement]);
  
  // Update canvas dimensions when video changes
  const updateCanvasDimensions = () => {
    if (!videoElement || !canvasRef.current) return;
    
    // Get the original video dimensions
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    
    if (videoWidth > 0 && videoHeight > 0) {
      // Get the displayed video dimensions and position
      const rect = videoElement.getBoundingClientRect();
      setVideoRect(rect);
      
      // Calculate position relative to container
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        
        // Get video's position within the container
        const canvasLeft = rect.left - containerRect.left;
        const canvasTop = rect.top - containerRect.top;
        
        // Set canvas size to match video's displayed size exactly
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
        
        // Position canvas exactly over video
        canvasRef.current.style.position = 'absolute';
        canvasRef.current.style.left = `${canvasLeft}px`;
        canvasRef.current.style.top = `${canvasTop}px`;
        canvasRef.current.style.width = `${rect.width}px`;
        canvasRef.current.style.height = `${rect.height}px`;
        
        // Calculate scaling factors between original and displayed dimensions
        const xScale = rect.width / videoWidth;
        const yScale = rect.height / videoHeight;
        
        setScaleFactor({ x: xScale, y: yScale });
      }
    }
  };
  
  // Watch for resize events
  useEffect(() => {
    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (videoElement) {
        updateCanvasDimensions();
      }
    });
    
    // Observe the container for size changes
    if (containerRef.current) {
      const container = containerRef.current.closest('.VideoAndOverlayContainer') || containerRef.current;
      resizeObserver.observe(container);
    }
    
    // Also observe window resizes
    window.addEventListener('resize', updateCanvasDimensions);
    
    // Schedule updates to handle any layout adjustments
    const intervalId = setInterval(updateCanvasDimensions, 1000);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCanvasDimensions);
      clearInterval(intervalId);
    };
  }, [videoElement]);
  
  // Draw bounding boxes and labels when predictions change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRect) {
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (predictions.length === 0) {
      return;
    }
    
    // Make sure canvas dimensions are set
    if (canvas.width === 0 || canvas.height === 0) {
      return;
    }
    
    // Check if we have valid scaling factors
    if (scaleFactor.x <= 0 || scaleFactor.y <= 0) {
      return;
    }
    
    // Draw each bounding box
    predictions.forEach((pred) => {
      const isUnknown = pred.name === 'Unknown';
      const color = getTrackColor(pred.trackId, isUnknown);
      
      // Apply scaling to all coordinates
      const scaledCoords = {
        x1: pred.x1 * scaleFactor.x,
        y1: pred.y1 * scaleFactor.y,
        x2: pred.x2 * scaleFactor.x,
        y2: pred.y2 * scaleFactor.y
      };
      
      // Ensure the box fits within canvas boundaries
      const x1 = Math.max(0, Math.min(canvas.width, scaledCoords.x1));
      const y1 = Math.max(0, Math.min(canvas.height, scaledCoords.y1));
      const x2 = Math.max(0, Math.min(canvas.width, scaledCoords.x2));
      const y2 = Math.max(0, Math.min(canvas.height, scaledCoords.y2));
      
      // Calculate box dimensions, ensuring minimum size
      const boxWidth = Math.max(5, x2 - x1);
      const boxHeight = Math.max(5, y2 - y1);
      
      // Draw bounding box
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.strokeRect(x1, y1, boxWidth, boxHeight);
      
      // Prepare label text
      const label = `${pred.name} (${Math.round(pred.confidence * 100)}%)`;
      
      // Set font for measuring text
      ctx.font = isUnknown ? '12px Arial' : 'bold 14px Arial';
      
      // Draw label background
      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width + 10;
      const textHeight = isUnknown ? 20 : 24;
      
      // Position label - ensure it's visible within canvas
      const labelX = Math.max(0, Math.min(x1, canvas.width - textWidth));
      const labelY = Math.max(textHeight, y1);
      
      // Label background
      ctx.fillStyle = color;
      ctx.fillRect(
        labelX, 
        labelY - textHeight, 
        textWidth, 
        textHeight
      );
      
      // Label text
      ctx.fillStyle = 'white';
      ctx.fillText(
        label, 
        labelX + 5, 
        labelY - (isUnknown ? 5 : 7)
      );
    });
  }, [predictions, scaleFactor, videoRect]);
  
  return (
    <Container ref={containerRef}>
      <StyledCanvas 
        ref={canvasRef}
        width={640}
        height={480}
      />
    </Container>
  );
};

const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 10;
`;

const StyledCanvas = styled.canvas`
  position: absolute;
  pointer-events: none;
`;

export default CanvasOverlay; 