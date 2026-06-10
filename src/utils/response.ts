import { Response } from 'express';

export interface ApiResponse<T> {
  status: 'success' | 'fail' | 'error';
  data?: T;
  message?: string;
  token?: string;
  total?: number;
  page?: number;
  pages?: number;
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  meta?: { total?: number; page?: number; pages?: number; token?: string }
): void => {
  const response: ApiResponse<T> = {
    status: 'success',
    data,
  };

  if (meta?.total !== undefined) response.total = meta.total;
  if (meta?.page !== undefined) response.page = meta.page;
  if (meta?.pages !== undefined) response.pages = meta.pages;
  if (meta?.token !== undefined) response.token = meta.token;

  res.status(statusCode).json(response);
};

export const sendMessage = (
  res: Response,
  message: string,
  statusCode: number = 200
): void => {
  res.status(statusCode).json({
    status: 'success',
    message,
  });
};
