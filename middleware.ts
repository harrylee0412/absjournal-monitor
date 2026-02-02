import { neonAuthMiddleware } from '@neondatabase/auth/next/server';

export default neonAuthMiddleware({
    // 未登录用户重定向到欢迎页
    loginUrl: '/welcome',
});

export const config = {
    matcher: [
        // 需要登录才能访问的路由

        '/journals/:path*',
        '/settings/:path*',
        '/account/:path*',
    ],
};
