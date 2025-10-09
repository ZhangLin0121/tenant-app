import axios from 'axios';

// 根据环境设置API基础URL
const isProduction = import.meta.env.PROD;
const baseURL = isProduction ? '/tenant' : '';

// 创建axios实例
const api = axios.create({
  baseURL,
  timeout: 10000,
});

export default api;