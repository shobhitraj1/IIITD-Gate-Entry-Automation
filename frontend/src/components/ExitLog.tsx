import React from 'react';
import styled from 'styled-components';
import { ExitLogEntry } from '../types';

interface ExitLogProps {
  entries: ExitLogEntry[];
}

const ExitLog: React.FC<ExitLogProps> = ({ entries }) => {
  // Sort entries by sortTime (newest first)
  const sortedEntries = [...entries].sort((a, b) => b.sortTime - a.sortTime);

  return (
    <Container>
      <h2>Exit Log</h2>
      
      {entries.length === 0 ? (
        <EmptyState>No exits recorded yet</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Name(s)</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry, index) => (
              <tr key={`${entry.sortTime}-${index}`}>
                <td>{entry.timestamp}</td>
                <td>{entry.names.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Container>
  );
};

const Container = styled.div`
  margin-top: 20px;
  
  h2 {
    font-size: 18px;
    margin-bottom: 10px;
  }
`;

const EmptyState = styled.div`
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 4px;
  text-align: center;
  color: #6c757d;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  
  th, td {
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #ddd;
  }
  
  th {
    background-color: #f2f2f2;
    font-weight: bold;
  }
  
  tr:nth-child(even) {
    background-color: #f9f9f9;
  }
  
  tr:hover {
    background-color: #f2f2f2;
  }
`;

export default ExitLog; 