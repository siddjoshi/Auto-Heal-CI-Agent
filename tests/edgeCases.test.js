const store = require('../src/models/taskStore');
const taskService = require('../src/services/taskService');

describe('Edge Cases', () => {
  beforeEach(() => {
    store.resetStore();
  });

  describe('Input sanitization', () => {
    test('should handle title with only spaces', () => {
      const result = taskService.createTask({ title: '     ' });
      expect(result.error).toBeDefined();
    });

    test('should handle numeric title', () => {
      const result = taskService.createTask({ title: 12345 });
      expect(result.error).toBeDefined();
    });

    test('should handle null input', () => {
      const result = taskService.createTask({});
      expect(result.error).toBeDefined();
    });

    test('should handle title at max length boundary', () => {
      const result = taskService.createTask({ title: 'a'.repeat(200) });
      expect(result.task).toBeDefined();
      expect(result.task.title).toHaveLength(200);
    });

    test('should reject title just over max length', () => {
      const result = taskService.createTask({ title: 'a'.repeat(201) });
      expect(result.error).toBeDefined();
    });
  });

  describe('Concurrent operations', () => {
    test('should assign sequential IDs', () => {
      const t1 = taskService.createTask({ title: 'First' });
      const t2 = taskService.createTask({ title: 'Second' });
      const t3 = taskService.createTask({ title: 'Third' });
      expect(t1.task.id).toBe(1);
      expect(t2.task.id).toBe(2);
      expect(t3.task.id).toBe(3);
    });

    test('should maintain ID sequence after deletion', () => {
      taskService.createTask({ title: 'One' });
      taskService.createTask({ title: 'Two' });
      taskService.deleteTask(1);
      const t3 = taskService.createTask({ title: 'Three' });
      expect(t3.task.id).toBe(3);
    });
  });

  describe('Filter edge cases', () => {
    test('should return empty array for non-matching filter', () => {
      taskService.createTask({ title: 'Task', priority: 'low' });
      const result = taskService.listTasks({ priority: 'critical' });
      expect(result).toHaveLength(0);
    });

    test('should handle combined filters', () => {
      taskService.createTask({ title: 'T1', priority: 'high', status: 'pending' });
      taskService.createTask({ title: 'T2', priority: 'high', status: 'completed' });
      taskService.createTask({ title: 'T3', priority: 'low', status: 'pending' });
      const result = taskService.listTasks({ priority: 'high', status: 'pending' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('T1');
    });
  });

  describe('Case-insensitive duplicate check', () => {
    test('should detect case-insensitive duplicates', () => {
      taskService.createTask({ title: 'My Task' });
      const result = taskService.createTask({ title: 'my task' });
      expect(result.error).toContain('already exists');
    });
  });

  // ==========================================
  // DELIBERATE FAILING TEST #2
  // This test expects getStats to return a 'completed' count of 2,
  // but only 1 task is completed. Copilot should fix the test assertion.
  // ==========================================
  describe('Auto-heal demo: wrong expected count', () => {
    test('should count completed tasks correctly', () => {
      taskService.createTask({ title: 'Done 1' });
      taskService.updateTask(1, { status: 'completed' });
      const stats = taskService.getStats();
      expect(stats.byStatus.completed).toBe(1);
    });
  });
});
