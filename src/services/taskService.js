const store = require('../models/taskStore');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES = ['pending', 'in-progress', 'completed', 'cancelled'];
const ALLOWED_TASK_FIELDS = ['title', 'description', 'priority', 'status'];

function isPlainObject(value) {
  return value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function sanitizeTaskData(data) {
  const sanitized = {};

  for (const field of ALLOWED_TASK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      sanitized[field] = data[field];
    }
  }

  return sanitized;
}

/**
 * Validate task input data. Returns { valid, errors }.
 */
function validateTaskInput(data, isUpdate = false) {
  const errors = [];

  if (!isPlainObject(data)) {
    return { valid: false, errors: ['Task data must be a JSON object'] };
  }

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

  const taskData = sanitizeTaskData(data);

  // Check for duplicate title
  const existing = store.findByTitle(taskData.title.trim());
  if (existing) {
    return { error: 'A task with this title already exists' };
  }

  const task = store.createTask({
    title: taskData.title.trim(),
    description: taskData.description ? taskData.description.trim() : '',
    priority: taskData.priority || 'medium',
    status: taskData.status || 'pending'
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

  const taskData = sanitizeTaskData(data);

  // If title is being changed, check for duplicates
  if (taskData.title) {
    const existing = store.findByTitle(taskData.title.trim());
    if (existing && existing.id !== numericId) {
      return { error: 'A task with this title already exists' };
    }
    taskData.title = taskData.title.trim();
  }

  const updated = store.updateTask(numericId, taskData);
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
