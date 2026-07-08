import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders AgentSwarm heading', () => {
    render(<App />);
    const headings = screen.getAllByText('AgentSwarm');
    expect(headings.length).toBeGreaterThanOrEqual(2);
  });

  it('renders start new task button', () => {
    render(<App />);
    expect(screen.getByText('Start a New Task')).toBeDefined();
  });
});
