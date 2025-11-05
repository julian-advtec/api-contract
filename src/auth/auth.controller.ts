import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    if (!body.username || !body.password) {
      throw new Error('Usuario y contraseña son requeridos');
    }

    const user = await this.authService.validateUser(body.username, body.password);
    return this.authService.login(user);
  }
}
