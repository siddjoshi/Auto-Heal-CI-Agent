const express = require('express');
const taskService = require('../services/taskService');

const router = express.Router();

// GET /tasks - List all tasks with optional filters
router.get('/', (req, res) => {
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  if (req.query.priority) filters.priority = req.query.priority;

  const tasks = taskService.listTasks(filters);
  res.json({ tasks, count: tasks.length });
});

// GET /tasks/stats - Get task statistics
router.get('/stats', (req, res) => {
  const stats = taskService.getStats();
  res.json(stats);
});

// GET /tasks/:id - Get a single task
router.get('/:id', (req, res) => {
  const result = taskService.getTask(req.params.id);
  if (result.error) {
    const status = result.error === 'Task not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.json(result.task);
});

// POST /tasks - Create a new task
router.post('/', (req, res) => {
  const result = taskService.createTask(req.body);
  if (result.error) {
    const status = result.error.includes('already exists') ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.status(201).json(result.task);
});

// PUT /tasks/:id - Update a task
router.put('/:id', (req, res) => {
  const result = taskService.updateTask(req.params.id, req.body);
  if (result.error) {
    const status = result.error === 'Task not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.json(result.task);
});

// DELETE /tasks/:id - Delete a task
router.delete('/:id', (req, res) => {
  const result = taskService.deleteTask(req.params.id);
  if (result.error) {
    const status = result.error === 'Task not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.status(204).send();
});

module.exports = router;
