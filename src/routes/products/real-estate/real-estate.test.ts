import { describe, it, expect } from 'vitest';
import { app } from '../../../index';

describe('Real Estate Module', () => {
  it('should return 200 OK and an empty list on /api/products/real-estate initially', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/products/real-estate'),
      { 
        DB: { prepare: () => ({ bind: () => ({ first: () => ({}), all: () => ({ results: [] }) }) }) },
      } as any
    );
    
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty('success', true);
  });
});
