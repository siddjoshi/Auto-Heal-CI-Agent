/**
 * In-memory task data store with CRUD operations.
 * Each task has: id, title, description, priority, status, createdAt, updatedAt
 */

let tasks = [];
let nextId = 1;

function resetStore() {
  tasks = [];
  nextId = 1;
}

function getAllTasks(filters = {}) {
  let result = [...tasks];

  if (filters.status) {
    result = result.filter(t => t.status === filters.status);
  }

  if (filters.priority) {
    result = result.filter(t => t.priority === filters.priority);
  }

  return result;
}

function getTaskById(id) {
  return tasks.find(t => t.id === id) || null;
}

function createTask(data) {
  const task = {
    id: nextId++,
    title: data.title,
    description: data.description || '',
    priority: data.priority || 'medium',
    status: data.status || 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  tasks.push(task);
  return task;
}

function updateTask(id, data) {
  const index = tasks.findIndex(t => t.id === id);
  if (index === -1) return null;

  const existing = tasks[index];
  const updated = {
    ...existing,
    ...data,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
  tasks[index] = updated;
  return updated;
}

function deleteTask(id) {
  const index = tasks.findIndex(t => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}

function findByTitle(title) {
  return tasks.find(t => t.title.toLowerCase() === title.toLowerCase()) || null;
}

module.exports = {
  resetStore,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  findByTitle
};
