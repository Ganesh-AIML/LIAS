import { adminApi } from './useAdminApi';

const withFaculty = (facultyId) =>
  facultyId ? `?faculty_id=${encodeURIComponent(facultyId)}` : '';

export const evaluateApi = {
  listStudents: (examId, facultyId) =>
    adminApi.get(`/admin/exams/${examId}/evaluate${withFaculty(facultyId)}`),

  getDetail: (examId, sessionId, facultyId) =>
    adminApi.get(`/admin/exams/${examId}/evaluate/${sessionId}${withFaculty(facultyId)}`),

  saveMarks: (examId, sessionId, body) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}`, body),

  clearMarks: (examId, sessionId) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}/clear`, {}),

  setReviewStatus: (examId, sessionId, status) =>
    adminApi.post(`/admin/exams/${examId}/evaluate/${sessionId}/review`, { status }),
};