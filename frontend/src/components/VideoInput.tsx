import React, { useRef, useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';

type VideoSource = 'webcam' | 'file';
type CameraFacing = 'user' | 'environment';

interface VideoInputProps {
  onFrame: (imageBlob: Blob) => void;
  onStop?: () => void; // Add an optional onStop callback
}

interface SourceButtonProps {
  active: boolean;
}

// Config parameters for frame capture
const TARGET_FPS = 60;
const JPEG_QUALITY = 0.8; // 0.0 to 1.0
const MAX_DIMENSION = 1920; // Limit large frames to reduce data size
const FRAME_SKIP = 1; // Send 1 in every N frames

const VideoInput: React.FC<VideoInputProps> = ({ onFrame, onStop }) => {
  const [source, setSource] = useState<VideoSource>('webcam');
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string>('');
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const fpsIntervalRef = useRef<number>(1000 / TARGET_FPS); // Target FPS
  const lastCaptureTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const skipFrameCountRef = useRef<number>(0); // Counter for frame skipping
  const frameCallbackRef = useRef(onFrame); // Store callback in ref to avoid recreating capture function
  
  // Detect if user is on a mobile device
  useEffect(() => {
    const detectMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
      setIsMobile(mobileRegex.test(userAgent));
    };
    
    detectMobile();
  }, []);
  
  // Update the callback ref when onFrame changes
  useEffect(() => {
    frameCallbackRef.current = onFrame;
  }, [onFrame]);

  // Reset the video stream when source changes
  useEffect(() => {
    stopVideoStream();
    setIsPlaying(false);
    setError(null);
    setDebug('');
    
    if (source === 'webcam') {
      setUploadedFile(null);
    }
  }, [source]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopVideoStream();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);
  
  // Stop current video stream
  const stopVideoStream = useCallback(() => {
    setDebug('Stopping video stream');
    if (videoRef.current) {
      // Stop video playback
      videoRef.current.pause();
      
      // Clear source object for webcams
      if (videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        const tracks = stream.getTracks();
        
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      
      // Release object URL for file sources
      if (videoRef.current.src && videoRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(videoRef.current.src);
        videoRef.current.src = '';
      }
    }
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    frameCountRef.current = 0;
    skipFrameCountRef.current = 0;
  }, []);
  
  // Toggle between front and rear camera
  const toggleCamera = useCallback(() => {
    // Log before changing
    setDebug(`Switching camera from ${cameraFacing} to ${cameraFacing === 'user' ? 'environment' : 'user'}...`);
    
    // Stop the current stream first
    stopVideoStream();
    setIsPlaying(false);
    
    // Toggle between front and rear camera
    setCameraFacing(prev => prev === 'user' ? 'environment' : 'user');
  }, [cameraFacing, stopVideoStream]);
  
  // Capture frames at specified FPS
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) {
      console.log('Video or canvas ref not available');
      rafRef.current = requestAnimationFrame(captureFrame);
      return;
    }
    
    const now = performance.now();
    const elapsed = now - lastCaptureTimeRef.current;
    
    if (elapsed < fpsIntervalRef.current) {
      // Not enough time elapsed, request next frame
      rafRef.current = requestAnimationFrame(captureFrame);
      return;
    }
    
    // Calculate target time for next frame
    lastCaptureTimeRef.current = now - (elapsed % fpsIntervalRef.current);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Check if video has valid dimensions and is actually playing
    if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.paused || video.ended) {
      console.log('Video not ready:', { 
        width: video.videoWidth, 
        height: video.videoHeight, 
        paused: video.paused, 
        ended: video.ended 
      });
      rafRef.current = requestAnimationFrame(captureFrame);
      return;
    }
    
    // Calculate dimensions while preserving aspect ratio
    let width = video.videoWidth;
    let height = video.videoHeight;
    
    // Scale down if too large
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        height = Math.floor(height * (MAX_DIMENSION / width));
        width = MAX_DIMENSION;
      } else {
        width = Math.floor(width * (MAX_DIMENSION / height));
        height = MAX_DIMENSION;
      }
    }
    
    // Set canvas dimensions
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get canvas context');
      rafRef.current = requestAnimationFrame(captureFrame);
      return;
    }
    
    // Draw current video frame to canvas
    try {
      // Clear the canvas first
      ctx.clearRect(0, 0, width, height);
      
      // Draw the video frame, potentially scaling it
      ctx.drawImage(video, 0, 0, width, height);
      
      // Update frame counter
      frameCountRef.current++;
      skipFrameCountRef.current = (skipFrameCountRef.current + 1) % FRAME_SKIP;
      
      if (frameCountRef.current % 15 === 0) {
        setDebug(`Captured frame #${frameCountRef.current} (${width}x${height})`);
      }
      
      // Only process every Nth frame (based on FRAME_SKIP)
      if (skipFrameCountRef.current === 0) {
        // Convert canvas to JPEG blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Log every 30th frame size for debugging
              if (frameCountRef.current % 30 === 0) {
                console.log(`Frame #${frameCountRef.current}: ${blob.size} bytes, ${width}x${height}`);
              }
              
              // Using the same approach as the successful test image button
              // Pass the blob directly to the parent component
              frameCallbackRef.current(blob);
            } else {
              console.error('Failed to create blob from canvas');
            }
            
            // Request next frame
            rafRef.current = requestAnimationFrame(captureFrame);
          },
          'image/jpeg',
          JPEG_QUALITY
        );
      } else {
        // Skip this frame, continue to next one immediately
        rafRef.current = requestAnimationFrame(captureFrame);
      }
    } catch (e) {
      console.error('Error capturing frame:', e);
      rafRef.current = requestAnimationFrame(captureFrame);
    }
  }, []); // No dependencies, use ref for dynamic values
  
  // Start the frame capture loop
  const startCapturing = useCallback(() => {
    console.log('Starting frame capture');
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    frameCountRef.current = 0;
    skipFrameCountRef.current = 0;
    lastCaptureTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(captureFrame);
    
    setDebug('Frame capture started');
  }, [captureFrame]);
  
  // Start webcam with improved error handling
  const startWebcam = useCallback(async () => {
    try {
      setError(null);
      setDebug(`Initializing webcam with facingMode: ${cameraFacing}...`);
      
      // Make sure any previous streams are cleaned up
      stopVideoStream();
      
      // Force-add facingMode to constraints to ensure it's applied
      const constraints = {
        video: {
          width: { ideal: MAX_DIMENSION },
          height: { ideal: MAX_DIMENSION },
          facingMode: { exact: cameraFacing } // Use "exact" to force the specific camera
        },
        audio: false
      };
      
      setDebug(`Requesting camera with constraints: facingMode=${cameraFacing}`);
      console.log('Requesting webcam with constraints:', constraints);
      
      // Check if navigator.mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported in this browser');
      }
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Obtained media stream with tracks:', stream.getTracks());
        
        if (videoRef.current) {
          setDebug(`Got stream with ${stream.getVideoTracks().length} video tracks. Camera facing: ${cameraFacing}`);
          
          // Set video element properties
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          videoRef.current.setAttribute('playsinline', 'true'); // For iOS
          
          videoRef.current.onloadedmetadata = () => {
            if (!videoRef.current) return;
            
            setDebug(`Video metadata loaded (${cameraFacing} camera), starting playback...`);
            console.log('Video metadata loaded, dimensions:', {
              width: videoRef.current.videoWidth,
              height: videoRef.current.videoHeight
            });
            
            // Explicitly set the video's display size to maintain aspect ratio
            const displayWidth = Math.min(videoRef.current.parentElement?.clientWidth || 640, 640);
            const aspectRatio = videoRef.current.videoHeight / videoRef.current.videoWidth;
            videoRef.current.style.width = `${displayWidth}px`;
            videoRef.current.style.height = `${displayWidth * aspectRatio}px`;
            
            videoRef.current.play()
              .then(() => {
                setIsPlaying(true);
                setDebug(`Video playing: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}, using ${cameraFacing} camera`);
                console.log('Video playback started successfully');
                
                // Reset frame counters before starting capture
                frameCountRef.current = 0;
                skipFrameCountRef.current = 0;
                startCapturing();
              })
              .catch(err => {
                setError(`Failed to play video: ${err.message}`);
                console.error('Video play error:', err);
              });
          };
          
          // Add error handlers for video element
          const handleVideoError = () => {
            if (!videoRef.current) return;
            
            const videoElement = videoRef.current;
            const errorMsg = videoElement.error?.message || 'Unknown error';
            setError(`Video element error: ${errorMsg}`);
            console.error('Video element error:', videoElement.error);
          };
          
          videoRef.current.onerror = handleVideoError;
        } else {
          throw new Error('Video element not available');
        }
      } catch (err) {
        // If exact constraint fails, try again with ideal constraint
        if (err instanceof Error && err.name === 'OverconstrainedError') {
          setDebug('Exact camera constraint failed, trying with "ideal" constraint...');
          
          // Try with ideal constraint instead
          const fallbackConstraints = {
            video: {
              width: { ideal: MAX_DIMENSION },
              height: { ideal: MAX_DIMENSION },
              facingMode: { ideal: cameraFacing } // Use ideal instead of exact
            },
            audio: false
          };
          
          try {
            const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            
            if (videoRef.current) {
              setDebug(`Got fallback stream with ${stream.getVideoTracks().length} video tracks`);
              
              // Set video element properties
              videoRef.current.srcObject = stream;
              videoRef.current.muted = true;
              videoRef.current.playsInline = true;
              videoRef.current.setAttribute('playsinline', 'true');
              
              videoRef.current.onloadedmetadata = () => {
                if (!videoRef.current) return;
                
                setDebug('Fallback video metadata loaded, starting playback...');
                
                // Explicitly set the video's display size to maintain aspect ratio
                const displayWidth = Math.min(videoRef.current.parentElement?.clientWidth || 640, 640);
                const aspectRatio = videoRef.current.videoHeight / videoRef.current.videoWidth;
                videoRef.current.style.width = `${displayWidth}px`;
                videoRef.current.style.height = `${displayWidth * aspectRatio}px`;
                
                videoRef.current.play()
                  .then(() => {
                    setIsPlaying(true);
                    setDebug(`Fallback video playing: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
                    
                    // Reset frame counters before starting capture
                    frameCountRef.current = 0;
                    skipFrameCountRef.current = 0;
                    startCapturing();
                  })
                  .catch(fallbackErr => {
                    setError(`Failed to play fallback video: ${fallbackErr.message}`);
                  });
              };
            }
          } catch (fallbackErr) {
            throw new Error(`Failed to access camera: ${fallbackErr instanceof Error ? fallbackErr.message : 'unknown error'}`);
          }
        } else {
          throw err; // Re-throw other errors
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Error accessing webcam: ${errorMessage}`);
      console.error('Error accessing webcam:', err);
    }
  }, [stopVideoStream, startCapturing, cameraFacing]);
  
  // Handle file upload with improved dimension handling
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    
    if (file) {
      setDebug(`Selected file: ${file.name} (${file.type}, ${file.size} bytes)`);
      
      if (!file.type.startsWith('video/')) {
        setError(`File must be a video. Selected file type: ${file.type}`);
        return;
      }
      
      if (videoRef.current) {
        setUploadedFile(file);
        
        // Release previous object URL if exists
        if (videoRef.current.src && videoRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(videoRef.current.src);
        }
        
        const fileURL = URL.createObjectURL(file);
        videoRef.current.src = fileURL;
        
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            const videoWidth = videoRef.current.videoWidth;
            const videoHeight = videoRef.current.videoHeight;
            
            setDebug(`Video metadata loaded: ${videoWidth}x${videoHeight}`);
            console.log('Video file dimensions:', { width: videoWidth, height: videoHeight });
            
            // Explicitly set the video's display size to maintain aspect ratio
            const displayWidth = Math.min(videoRef.current.parentElement?.clientWidth || 640, 640);
            const aspectRatio = videoHeight / videoWidth;
            videoRef.current.style.width = `${displayWidth}px`;
            videoRef.current.style.height = `${displayWidth * aspectRatio}px`;
            
            videoRef.current.play()
              .then(() => {
                setIsPlaying(true);
                setDebug('Video playing, starting frame capture');
                startCapturing();
              })
              .catch(err => {
                setError(`Failed to play video: ${err.message}`);
                console.error('Video play error:', err);
              });
          }
        };
        
        videoRef.current.onerror = () => {
          setError(`Error loading video file: ${file.name}`);
          console.error('Video load error');
        };
      }
    }
  };
  
  return (
    <Container>
      <ControlsContainer className="ControlsContainer">
        <SourceToggle>
          <SourceButton
            active={source === 'webcam'}
            onClick={() => setSource('webcam')}
          >
            Webcam
          </SourceButton>
          <SourceButton
            active={source === 'file'}
            onClick={() => setSource('file')}
          >
            Video File
          </SourceButton>
        </SourceToggle>
        
        {!isPlaying && source === 'webcam' && (
          <StartButton 
            onClick={startWebcam}
            disabled={isPlaying}
          >
            Start Camera
          </StartButton>
        )}
        
        {isMobile && source === 'webcam' && (
          <CameraToggleButton 
            onClick={() => {
              toggleCamera();
              // Force restart webcam after toggle
              setTimeout(() => {
                startWebcam();
              }, 500);
            }}
            disabled={!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia}
          >
            {cameraFacing === 'user' ? 'Switch to Back Camera' : 'Switch to Front Camera'}
          </CameraToggleButton>
        )}
        
        {!isPlaying && source === 'file' && (
          <FileInput>
            <input 
              type="file" 
              accept="video/*" 
              onChange={handleFileChange} 
              disabled={isPlaying}
            />
          </FileInput>
        )}
        
        {isPlaying && (
          <StopButton onClick={() => {
            stopVideoStream();
            setIsPlaying(false);
            // Call the onStop callback if provided
            if (onStop) {
              onStop();
            }
          }}>
            Stop
          </StopButton>
        )}
      </ControlsContainer>
      
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {debug && <DebugInfo className="DebugInfo">{debug}</DebugInfo>}
      
      <VideoContainer className="VideoContainer">
        <video
          ref={videoRef}
          style={{ display: isPlaying ? 'block' : 'none' }}
          playsInline
          muted
        />
        <canvas 
          ref={canvasRef} 
          style={{ display: 'none' }}
        />
      </VideoContainer>
    </Container>
  );
};

const Container = styled.div`
  margin-bottom: 20px;
`;

const ControlsContainer = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
`;

const SourceToggle = styled.div`
  display: flex;
`;

const SourceButton = styled.button<SourceButtonProps>`
  padding: 8px 16px;
  background-color: ${(props: SourceButtonProps) => props.active ? '#3498db' : '#f0f0f0'};
  color: ${(props: SourceButtonProps) => props.active ? 'white' : 'black'};
  border: 1px solid #ddd;
  cursor: pointer;
  transition: all 0.2s;
  
  &:first-child {
    border-radius: 4px 0 0 4px;
  }
  
  &:last-child {
    border-radius: 0 4px 4px 0;
  }
  
  &:hover {
    background-color: ${(props: SourceButtonProps) => props.active ? '#2980b9' : '#e0e0e0'};
  }
`;

const StartButton = styled.button`
  padding: 8px 16px;
  background-color: #2ecc71;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  
  &:disabled {
    background-color: #95a5a6;
    cursor: not-allowed;
  }
`;

const StopButton = styled.button`
  padding: 8px 16px;
  background-color: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`;

const CameraToggleButton = styled.button`
  padding: 8px 16px;
  background-color: #9b59b6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  
  &:disabled {
    background-color: #95a5a6;
    cursor: not-allowed;
  }
`;

const FileInput = styled.div`
  input {
    cursor: pointer;
  }
`;

const ErrorMessage = styled.div`
  background-color: #f8d7da;
  color: #721c24;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 10px;
`;

const DebugInfo = styled.div`
  background-color: #d1ecf1;
  color: #0c5460;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-family: monospace;
  font-size: 12px;
`;

const VideoContainer = styled.div`
  position: relative;
  video {
    max-width: 100%;
    border: 1px solid #ddd;
    background-color: #000;
    max-height: 480px;
    width: auto;
    height: auto;
    display: block;
  }
`;

export default VideoInput; 