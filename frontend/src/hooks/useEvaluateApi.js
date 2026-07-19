import { adminApi } from './useAdminApi';

export const evaluateApi = {
  listStudents: (examId) =>
    adminApi.get(`/admin/exams/${examId}/evaluate`),

  getDetail: (examId, sessionId) =>
    adminApi.get(`/admin/exams/${examId}/evaluate/${sessionId}`),

  saveMarks: (examId, sessionId, body) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}`, body),

  clearMarks: (examId, sessionId) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}/clear`, {}),

  setReviewStatus: (examId, sessionId, status) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}/review`, { status }),
};
