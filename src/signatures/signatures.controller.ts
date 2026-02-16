// signatures/signatures.controller.ts
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
  Query,
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import type { Response } from 'express'; // 👈 IMPORTAR COMO TYPE
import { JwtService } from '@nestjs/jwt';
import { SignaturesService } from './signatures.service';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SignatureRoleGuard } from './guards/signature-role.guard';

// Definir la interfaz para el usuario en el request
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
    // 👈 DECLARAR LA PROPIEDAD PRIVADA
    private jwtService: JwtService;

    constructor(
        private readonly signaturesService: SignaturesService,
        jwtService: JwtService // 👈 RECIBIR EN CONSTRUCTOR
    ) {
        this.jwtService = jwtService; // 👈 ASIGNAR A LA PROPIEDAD
    }

    @Get('my-signature')
    async getMySignature(@Req() req: RequestWithUser) {
        console.log('👤 Usuario desde token:', req.user);
        console.log('👤 id:', req.user.id);
        return this.signaturesService.getMySignature(req.user.id);
    }

    @Post('upload')
    @UseGuards(SignatureRoleGuard)
    @UseInterceptors(FileInterceptor('file'))
    async uploadSignature(
        @Req() req: RequestWithUser,
        @UploadedFile() file: Express.Multer.File,
        @Body() createSignatureDto: CreateSignatureDto,
    ) {
        console.log('👤 Usuario desde token:', req.user);
        console.log('👤 id:', req.user.id);
        console.log('📥 file:', file?.originalname);
        console.log('📥 name:', createSignatureDto.name);

        return this.signaturesService.uploadSignature(
            req.user.id,
            file,
            createSignatureDto.name
        );
    }

    @Delete('delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteSignature(@Req() req: RequestWithUser) {
        await this.signaturesService.deleteSignature(req.user.id);
    }

    @Get('has-signature')
    async hasSignature(@Req() req: RequestWithUser) {
        const has = await this.signaturesService.hasSignature(req.user.id);
        return { has };
    }

// signatures/signatures.controller.ts

@Get('view')
@UseGuards(JwtAuthGuard) // El token ya viene validado por el guard
async viewSignature(@Req() req: RequestWithUser, @Res() res: Response) {
  console.log('👁️ Vista de firma solicitada para usuario:', req.user.id);
  
  try {
    const signature = await this.signaturesService.getSignatureForSigning(req.user.id);
    
    res.setHeader('Content-Type', signature.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(signature.buffer);
  } catch (error) {
    console.error('Error al obtener firma:', error.message);
    res.status(404).json({ message: 'Firma no encontrada' });
  }
}

}
