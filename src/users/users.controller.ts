import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @Post('register')
  async register(@Body() body: { username: string; password: string }) {
    if (!body.username || !body.password) {
      throw new Error('Debe enviar nombre de usuario y contraseña');
    }
    return this.usersService.create(body.username, body.password);
  }
}
