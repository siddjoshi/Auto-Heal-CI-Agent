const store = require('../models/taskStore');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES = ['pending', 'in-progress', 'completed', 'cancelled'];

/**
 * Validate task input data. Returns { valid, errors }.
 */
function validateTaskInput(data, isUpdate = false) {
  const errors = [];

  if (!isUpdate && (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0)) {
    errors.push('Title is required and must be a non-empty string');
  }

  if (data.title && typeof data.title === 'string' && data.title.trim().length > 200) {
    errors.push('Title must be 200 characters or fewer');
  }

  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  if (data.status && !VALID_STATUSES.includes(data.status)) {
    errors.push(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (data.description && typeof data.description !== 'string') {
    errors.push('Description must be a string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * List tasks with optional filtering.
 */
function listTasks(filters = {}) {
  return store.getAllTasks(filters);
}

/**
 * Get a single task by ID. Returns null if not found.
 */
function getTask(id) {
  const numericId = parseInt(id, 10);
  if (isNaN(numericId) || numericId <= 0) {
    return { error: 'Invalid task ID' };
  }
  const task = store.getTaskById(numericId);
  if (!task) {
    return { error: 'Task not found' };
  }
  return { task };
}

/**
 * Create a new task. Validates input and checks for duplicates.
 */
function createTask(data) {
  const validation = validateTaskInput(data);
  if (!validation.valid) {
    return { error: validation.errors.join('; ') };
  }

  // Check for duplicate title
  const existing = store.findByTitle(data.title.trim());
  if (existing) {
    return { error: 'A task with this title already exists' };
  }

  const task = store.createTask({
    title: data.title.trim(),
    description: data.description ? data.description.trim() : '',
    priority: data.priority || 'medium',
    status: data.status || 'pending'
  });

  return { task };
}

/**
 * Update an existing task.
 */
function updateTask(id, data) {
  const numericId = parseInt(id, 10);
  if (isNaN(numericId) || numericId <= 0) {
    return { error: 'Invalid task ID' };
  }

  const validation = validateTaskInput(data, true);
  if (!validation.valid) {
    return { error: validation.errors.join('; ') };
  }

  // If title is being changed, check for duplicates
  if (data.title) {
    const existing = store.findByTitle(data.title.trim());
    if (existing && existing.id !== numericId) {
      return { error: 'A task with this title already exists' };
    }
    data.title = data.title.trim();
  }

  const updated = store.updateTask(numericId, data);
  if (!updated) {
    return { error: 'Task not found' };
  }

  return { task: updated };
}

/**
 * Delete a task by ID.
 */
function deleteTask(id) {
  const numericId = parseInt(id, 10);
  if (isNaN(numericId) || numericId <= 0) {
    return { error: 'Invalid task ID' };
  }

  const deleted = store.deleteTask(numericId);
  if (!deleted) {
    return { error: 'Task not found' };
  }

  return { success: true };
}

/**
 * Get task statistics.
 */
function getStats() {
  const all = store.getAllTasks();
  const stats = {
    total: all.length,
    byStatus: {},
    byPriority: {}
  };

  for (const status of VALID_STATUSES) {
    stats.byStatus[status] = all.filter(t => t.status === status).length;
  }

  for (const priority of VALID_PRIORITIES) {
    stats.byPriority[priority] = all.filter(t => t.priority === priority).length;
  }

  return stats;
}

module.exports = {
  validateTaskInput,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getStats,
  VALID_PRIORITIES,
  VALID_STATUSES
};
