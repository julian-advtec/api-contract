import {
  Controller,
  Post,
  Get,
  Delete,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SignatureRoleGuard } from './guards/signature-role.guard';
import { SignaturesService } from './signatures.service';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { NotFoundException } from '@nestjs/common';

interface RequestWithUser extends Request {
  user: {
    id: string;
    username: string;
    role: string;
    email: string;
  };
}

@Controller('signatures')
@UseGuards(JwtAuthGuard)
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Get('my-signature')
  async getMySignature(@Req() req: RequestWithUser) {
    return this.signaturesService.getMySignature(req.user.id);
  }

  // ✅ Usar query param en lugar de optional param
  @Post('upload')
  @UseGuards(SignatureRoleGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSignature(
    @Req() req: RequestWithUser,
    @Query('userId') targetUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() createSignatureDto: CreateSignatureDto,
  ) {
    const userId = (req.user.role === 'admin' && targetUserId) 
      ? targetUserId 
      : req.user.id;
    
    console.log(`📤 Subiendo firma - Usuario objetivo: ${userId} (Admin: ${req.user.role === 'admin'})`);
    
    return this.signaturesService.uploadSignature(
      userId,
      file,
      createSignatureDto.name,
    );
  }

  @Delete('delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSignature(
    @Req() req: RequestWithUser,
    @Query('userId') targetUserId: string,
  ) {
    const userId = (req.user.role === 'admin' && targetUserId) 
      ? targetUserId 
      : req.user.id;
    
    await this.signaturesService.deleteSignature(userId);
  }

  @Get('has-signature')
  async hasSignature(
    @Req() req: RequestWithUser,
    @Query('userId') targetUserId: string,
  ) {
    const userId = (req.user.role === 'admin' && targetUserId) 
      ? targetUserId 
      : req.user.id;
    
    const has = await this.signaturesService.hasSignature(userId);
    return { has };
  }

  @Get('view')
  async viewSignature(
    @Req() req: RequestWithUser,
    @Query('userId') targetUserId: string,
    @Res() res: Response,
  ) {
    const userId = (req.user.role === 'admin' && targetUserId) 
      ? targetUserId 
      : req.user.id;
    
    console.log(`[VIEW] Solicitando firma para usuario: ${userId}`);

    try {
      const signature = await this.signaturesService.getSignatureForSigning(userId);

      res.setHeader('Content-Type', signature.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="firma.${signature.type === 'pdf' ? 'pdf' : 'png'}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(signature.buffer);
    } catch (error) {
      console.error('[VIEW] Error al servir firma:', error.message);
      if (error instanceof NotFoundException) {
        res.status(HttpStatus.NOT_FOUND).json({ message: 'No tienes una firma registrada' });
      } else {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Error al cargar la firma' });
      }
    }
  }
}