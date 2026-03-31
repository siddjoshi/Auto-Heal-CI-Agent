const store = require('../src/models/taskStore');
const taskService = require('../src/services/taskService');

describe('TaskService', () => {
  beforeEach(() => {
    store.resetStore();
  });

  describe('validateTaskInput', () => {
    test('should accept valid task data', () => {
      const result = taskService.validateTaskInput({
        title: 'Test task',
        priority: 'high',
        status: 'pending'
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject missing title', () => {
      const result = taskService.validateTaskInput({});
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Title is required');
    });

    test('should reject empty title', () => {
      const result = taskService.validateTaskInput({ title: '   ' });
      expect(result.valid).toBe(false);
    });

    test('should reject invalid priority', () => {
      const result = taskService.validateTaskInput({ title: 'Test', priority: 'urgent' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Priority must be one of');
    });

    test('should reject invalid status', () => {
      const result = taskService.validateTaskInput({ title: 'Test', status: 'done' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Status must be one of');
    });

    test('should reject title over 200 characters', () => {
      const result = taskService.validateTaskInput({ title: 'a'.repeat(201) });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('200 characters');
    });

    test('should allow missing title on update', () => {
      const result = taskService.validateTaskInput({ priority: 'high' }, true);
      expect(result.valid).toBe(true);
    });

    test('should reject non-object task data', () => {
      const result = taskService.validateTaskInput(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('JSON object');
    });
  });

  describe('createTask', () => {
    test('should create a task with defaults', () => {
      const result = taskService.createTask({ title: 'New task' });
      expect(result.task).toBeDefined();
      expect(result.task.title).toBe('New task');
      expect(result.task.priority).toBe('medium');
      expect(result.task.status).toBe('pending');
      expect(result.task.id).toBe(1);
    });

    test('should create a task with custom fields', () => {
      const result = taskService.createTask({
        title: 'Custom task',
        description: 'A description',
        priority: 'critical',
        status: 'in-progress'
      });
      expect(result.task.priority).toBe('critical');
      expect(result.task.status).toBe('in-progress');
      expect(result.task.description).toBe('A description');
    });

    test('should reject duplicate titles', () => {
      taskService.createTask({ title: 'Unique task' });
      const result = taskService.createTask({ title: 'Unique task' });
      expect(result.error).toContain('already exists');
    });

    test('should trim whitespace from title', () => {
      const result = taskService.createTask({ title: '  Trimmed  ' });
      expect(result.task.title).toBe('Trimmed');
    });

    test('should ignore unexpected fields on create', () => {
      const result = taskService.createTask({ title: 'New task', unexpected: 'value' });
      expect(result.task.title).toBe('New task');
      expect(result.task.unexpected).toBeUndefined();
    });
  });

  describe('getTask', () => {
    test('should retrieve existing task', () => {
      taskService.createTask({ title: 'Find me' });
      const result = taskService.getTask(1);
      expect(result.task.title).toBe('Find me');
    });

    test('should return error for non-existent task', () => {
      const result = taskService.getTask(999);
      expect(result.error).toBe('Task not found');
    });

    test('should return error for invalid ID', () => {
      const result = taskService.getTask('abc');
      expect(result.error).toBe('Invalid task ID');
    });

    test('should return error for negative ID', () => {
      const result = taskService.getTask(-1);
      expect(result.error).toBe('Invalid task ID');
    });
  });

  describe('updateTask', () => {
    test('should update existing task fields', () => {
      taskService.createTask({ title: 'Original' });
      const result = taskService.updateTask(1, { title: 'Updated', priority: 'high' });
      expect(result.task.title).toBe('Updated');
      expect(result.task.priority).toBe('high');
    });

    test('should preserve unchanged fields', () => {
      taskService.createTask({ title: 'Keep me', priority: 'low' });
      const result = taskService.updateTask(1, { status: 'completed' });
      expect(result.task.title).toBe('Keep me');
      expect(result.task.priority).toBe('low');
      expect(result.task.status).toBe('completed');
    });

    test('should reject update to duplicate title', () => {
      taskService.createTask({ title: 'First' });
      taskService.createTask({ title: 'Second' });
      const result = taskService.updateTask(2, { title: 'First' });
      expect(result.error).toContain('already exists');
    });

    test('should ignore unexpected fields on update', () => {
      taskService.createTask({ title: 'Original' });
      const result = taskService.updateTask(1, { title: 'Updated', unexpected: 'value' });
      expect(result.task.title).toBe('Updated');
      expect(result.task.unexpected).toBeUndefined();
    });
  });

  describe('deleteTask', () => {
    test('should delete existing task', () => {
      taskService.createTask({ title: 'Delete me' });
      const result = taskService.deleteTask(1);
      expect(result.success).toBe(true);
    });

    test('should return error for non-existent task', () => {
      const result = taskService.deleteTask(999);
      expect(result.error).toBe('Task not found');
    });
  });

  describe('listTasks', () => {
    beforeEach(() => {
      taskService.createTask({ title: 'Task 1', priority: 'low', status: 'pending' });
      taskService.createTask({ title: 'Task 2', priority: 'high', status: 'completed' });
      taskService.createTask({ title: 'Task 3', priority: 'high', status: 'pending' });
    });

    test('should list all tasks', () => {
      const tasks = taskService.listTasks();
      expect(tasks).toHaveLength(3);
    });

    test('should filter by status', () => {
      const tasks = taskService.listTasks({ status: 'pending' });
      expect(tasks).toHaveLength(2);
    });

    test('should filter by priority', () => {
      const tasks = taskService.listTasks({ priority: 'high' });
      expect(tasks).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', () => {
      taskService.createTask({ title: 'T1', priority: 'low', status: 'pending' });
      taskService.createTask({ title: 'T2', priority: 'high', status: 'completed' });
      const stats = taskService.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byPriority.low).toBe(1);
      expect(stats.byPriority.high).toBe(1);
    });
  });
});
