import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Query, 
  Param, 
  UseGuards,
  HttpCode,
  HttpStatus 
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ContratistaService } from './contratista.service';

@Controller('contratistas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
export class ContratistasController {
  constructor(private readonly contratistaService: ContratistaService) {}

  @Get()
  async obtenerTodos() {
    const contratistas = await this.contratistaService.obtenerTodos();
    return {
      success: true,
      count: contratistas.length,
      data: contratistas
    };
  }

  @Get('buscar')
  async buscar(@Query('termino') termino: string) {
    const contratistas = await this.contratistaService.buscarPorTermino(termino);
    return {
      success: true,
      count: contratistas.length,
      data: contratistas
    };
  }

  @Get('estadisticas')
  async obtenerEstadisticas() {
    const estadisticas = await this.contratistaService.obtenerEstadisticas();
    return {
      success: true,
      data: estadisticas
    };
  }

  @Get(':id')
  async obtenerPorId(@Param('id') id: string) {
    const contratista = await this.contratistaService.buscarPorId(id);
    return {
      success: true,
      data: contratista
    };
  }

  @Get('documento/:documento')
  async obtenerPorDocumento(@Param('documento') documento: string) {
    const contratista = await this.contratistaService.buscarPorDocumento(documento);
    return {
      success: true,
      data: contratista
    };
  }

  @Post()
  async crear(@Body() body: { documentoIdentidad: string, nombreCompleto: string }) {
    const contratista = await this.contratistaService.crear(body);
    return {
      success: true,
      message: 'Contratista creado exitosamente',
      data: contratista
    };
  }

  @Put(':id')
  async actualizar(
    @Param('id') id: string,
    @Body() body: Partial<{ documentoIdentidad: string, nombreCompleto: string }>
  ) {
    const contratista = await this.contratistaService.actualizar(id, body);
    return {
      success: true,
      message: 'Contratista actualizado exitosamente',
      data: contratista
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('id') id: string) {
    await this.contratistaService.eliminar(id);
    return {
      success: true,
      message: 'Contratista eliminado exitosamente'
    };
  }
}