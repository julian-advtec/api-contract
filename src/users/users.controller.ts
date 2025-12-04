import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards,
  Query,
  Request,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './enums/user-role.enum';

@Controller('users')
// @UseGuards(JwtAuthGuard, RolesGuard) // COMENTADO
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  // @Roles(UserRole.ADMIN) // COMENTADO
  findAll() {
    return this.usersService.findAll();
  }

  @Get('filtered')
  // @Roles(UserRole.ADMIN) // COMENTADO
  findWithFilters(
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
    @Query('isActive') isActive?: boolean,
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ) {
    return this.usersService.findWithFilters({
      search,
      role,
      isActive: isActive !== undefined ? isActive === true : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10
    });
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  getUsersStats() {
    return this.usersService.getUsersStats();
  }

  @Get('role/:role')
  @Roles(UserRole.ADMIN)
  findByRole(@Param('role') role: UserRole) {
    return this.usersService.getUsersByRole(role);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createUserDto: CreateUserDto, @Request() req: any) {
    return this.usersService.create(createUserDto, req.user?.userId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string, 
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: any
  ) {
    return this.usersService.update(id, updateUserDto, req.user?.userId);
  }

  @Patch(':id/toggle-status')
  @Roles(UserRole.ADMIN)
  toggleStatus(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.toggleUserStatus(id, req.user?.userId);
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  activate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.activateUser(id, req.user?.userId);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.deactivateUser(id, req.user?.userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  @Delete(':id/soft')
  @Roles(UserRole.ADMIN)
  softRemove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.softRemove(id, req.user?.userId);
  }

  
}