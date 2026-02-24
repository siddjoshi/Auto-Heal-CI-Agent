const request = require('supertest');
const app = require('../src/app');
const store = require('../src/models/taskStore');

describe('Task Routes', () => {
  beforeEach(() => {
    store.resetStore();
  });

  describe('GET /health', () => {
    test('should return health check', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /tasks', () => {
    test('should create a task', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'New task', priority: 'high' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New task');
      expect(res.body.priority).toBe('high');
      expect(res.body.id).toBeDefined();
    });

    test('should reject task without title', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ priority: 'high' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Title is required');
    });

    test('should reject duplicate titles', async () => {
      await request(app).post('/tasks').send({ title: 'Unique' });
      const res = await request(app).post('/tasks').send({ title: 'Unique' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /tasks', () => {
    beforeEach(async () => {
      await request(app).post('/tasks').send({ title: 'Task A', status: 'pending', priority: 'low' });
      await request(app).post('/tasks').send({ title: 'Task B', status: 'completed', priority: 'high' });
    });

    test('should list all tasks', async () => {
      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.count).toBe(2);
    });

    test('should filter tasks by status', async () => {
      const res = await request(app).get('/tasks?status=completed');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].title).toBe('Task B');
    });
  });

  describe('GET /tasks/:id', () => {
    test('should get task by id', async () => {
      await request(app).post('/tasks').send({ title: 'Find me' });
      const res = await request(app).get('/tasks/1');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Find me');
    });

    test('should return 404 for non-existent task', async () => {
      const res = await request(app).get('/tasks/999');
      expect(res.status).toBe(404);
    });

    test('should return 400 for invalid id', async () => {
      const res = await request(app).get('/tasks/abc');
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /tasks/:id', () => {
    test('should update a task', async () => {
      await request(app).post('/tasks').send({ title: 'Original' });
      const res = await request(app)
        .put('/tasks/1')
        .send({ title: 'Updated', priority: 'critical' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated');
      expect(res.body.priority).toBe('critical');
    });

    test('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .put('/tasks/999')
        .send({ title: 'Ghost' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /tasks/:id', () => {
    test('should delete a task', async () => {
      await request(app).post('/tasks').send({ title: 'Delete me' });
      const res = await request(app).delete('/tasks/1');
      expect(res.status).toBe(204);
    });

    test('should return 404 for non-existent task', async () => {
      const res = await request(app).delete('/tasks/999');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // DELIBERATE FAILING TEST #1
  // This test has a wrong expected value to demonstrate auto-healing.
  // The /health endpoint returns { status: 'ok' }, but this test
  // expects 'healthy' — Copilot should fix this.
  // ==========================================
  describe('Auto-heal demo: wrong assertion', () => {
    test('should verify health endpoint returns correct status', async () => {
      const res = await request(app).get('/health');
      expect(res.body.status).toBe('ok');  // fixed: API returns 'ok'
    });
  });

  describe('404 handling', () => {
    test('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Route not found');
    });
  });
});
