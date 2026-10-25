import React from 'react';
import { z } from 'zod';
import {
  StackPropsSchema,
  TextPropsSchema,
  ButtonPropsSchema,
  ExportButtonPropsSchema,
  TablePropsSchema,
  FormPropsSchema,
  ModalPropsSchema,
  SelectPropsSchema,
  InputPropsSchema,
  DetailsPropsSchema,
  GridPropsSchema,
  CardPropsSchema,
  TabsPropsSchema,
  StatPropsSchema,
  ChartPropsSchema,
  VisualPropsSchema,
} from '@config-platform/schema';
import { StackComponent } from '../components/stack';
import { TextComponent } from '../components/text';
import { ButtonComponent } from '../components/button';
import { ExportButtonComponent } from '../components/export-button';
import { TableComponent } from '../components/table';
import { FormComponent } from '../components/form';
import { ModalComponent } from '../components/modal';
import { SelectComponent } from '../components/select';
import { InputComponent } from '../components/input';
import { DetailsComponent } from '../components/details';
import { GridComponent } from '../components/grid';
import { CardComponent } from '../components/card';
import { TabsComponent } from '../components/tabs';
import { StatComponent } from '../components/stat';
import { ChartComponent } from '../components/chart';
import { VisualComponent } from '../components/visual';

export interface ComponentRegistration<P = any> {
  component: React.ComponentType<P>;
  propsSchema: z.ZodType<P, any, any>;
}

export class ComponentRegistry {
  private registry = new Map<string, ComponentRegistration>();

  register<P>(type: string, registration: ComponentRegistration<P>): this {
    this.registry.set(type, registration);
    return this;
  }

  get(type: string): ComponentRegistration | undefined {
    return this.registry.get(type);
  }

  has(type: string): boolean {
    return this.registry.has(type);
  }
}

export const defaultRegistry = new ComponentRegistry();

// Register built-in components
defaultRegistry.register('stack', {
  component: StackComponent,
  propsSchema: StackPropsSchema,
});

defaultRegistry.register('text', {
  component: TextComponent,
  propsSchema: TextPropsSchema,
});

defaultRegistry.register('button', {
  component: ButtonComponent,
  propsSchema: ButtonPropsSchema,
});

defaultRegistry.register('exportButton', {
  component: ExportButtonComponent,
  propsSchema: ExportButtonPropsSchema,
});

defaultRegistry.register('table', {
  component: TableComponent,
  propsSchema: TablePropsSchema,
});

defaultRegistry.register('form', {
  component: FormComponent,
  propsSchema: FormPropsSchema,
});

defaultRegistry.register('modal', {
  component: ModalComponent,
  propsSchema: ModalPropsSchema,
});

defaultRegistry.register('select', {
  component: SelectComponent,
  propsSchema: SelectPropsSchema,
});

defaultRegistry.register('input', {
  component: InputComponent,
  propsSchema: InputPropsSchema,
});

defaultRegistry.register('details', {
  component: DetailsComponent,
  propsSchema: DetailsPropsSchema,
});

defaultRegistry.register('grid', {
  component: GridComponent,
  propsSchema: GridPropsSchema,
});

defaultRegistry.register('card', {
  component: CardComponent,
  propsSchema: CardPropsSchema,
});

defaultRegistry.register('tabs', {
  component: TabsComponent,
  propsSchema: TabsPropsSchema,
});

defaultRegistry.register('stat', {
  component: StatComponent,
  propsSchema: StatPropsSchema,
});

defaultRegistry.register('chart', {
  component: ChartComponent,
  propsSchema: ChartPropsSchema,
});

defaultRegistry.register('visual', {
  component: VisualComponent,
  propsSchema: VisualPropsSchema,
});
