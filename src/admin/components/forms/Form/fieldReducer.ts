import equal from 'deep-equal';
import { unflatten, flatten } from 'flatley';
import flattenFilters from './flattenFilters';
import getSiblingData from './getSiblingData';
import reduceFieldsToValues from './reduceFieldsToValues';
import { Field, FieldAction, Fields } from './types';
import deepCopyObject from '../../../../utilities/deepCopyObject';

const unflattenRowsFromState = (state: Fields, path: string) => {
  // Take a copy of state
  const remainingFlattenedState = { ...state };

  const rowsFromStateObject = {};

  const pathPrefixToRemove = path.substring(0, path.lastIndexOf('.') + 1);

  // Loop over all keys from state
  // If the key begins with the name of the parent field,
  // Add value to rowsFromStateObject and delete it from remaining state
  Object.keys(state).forEach((key) => {
    if (key.indexOf(`${path}.`) === 0) {
      if (!state[key].disableFormData) {
        const name = key.replace(pathPrefixToRemove, '');
        rowsFromStateObject[name] = state[key];
        rowsFromStateObject[name].initialValue = rowsFromStateObject[name].value;
      }

      delete remainingFlattenedState[key];
    }
  });

  const unflattenedRows = unflatten(rowsFromStateObject);

  return {
    unflattenedRows: unflattenedRows[path.replace(pathPrefixToRemove, '')] || [],
    remainingFlattenedState,
  };
};

function fieldReducer(state: Fields, action: FieldAction): Fields {
  switch (action.type) {
    case 'REPLACE_STATE': {
      const newState = {};

      // Only update fields that have changed
      // by comparing old value / initialValue to new
      // ..
      // This is a performance enhancement for saving
      // large documents with hundreds of fields

      Object.entries(action.state).forEach(([path, field]) => {
        const oldField = state[path];
        const newField = field;

        if (!equal(oldField, newField)) {
          newState[path] = newField;
        } else if (oldField) {
          newState[path] = oldField;
        }
      });

      return newState;
    }

    case 'REMOVE': {
      const newState = { ...state };
      if (newState[action.path]) delete newState[action.path];
      return newState;
    }

    case 'REMOVE_ROW': {
      const { rowIndex, path } = action;
      const { unflattenedRows, remainingFlattenedState } = unflattenRowsFromState(state, path);

      unflattenedRows.splice(rowIndex, 1);

      const flattenedRowState = unflattenedRows.length > 0 ? flatten({ [path]: unflattenedRows }, { filters: flattenFilters }) : {};

      return {
        ...remainingFlattenedState,
        [path]: {
          ...(state[path] || {}),
          disableFormData: unflattenedRows.length > 0,
        },
        ...flattenedRowState,
      };
    }

    case 'ADD_ROW': {
      const {
        rowIndex, path, subFieldState, blockType,
      } = action;
      const { unflattenedRows, remainingFlattenedState } = unflattenRowsFromState(state, path);

      if (blockType) {
        subFieldState.blockType = {
          value: blockType,
          initialValue: blockType,
          valid: true,
        };
      }

      // If there are subfields
      if (Object.keys(subFieldState).length > 0) {
        // Add new object containing subfield names to unflattenedRows array
        unflattenedRows.splice(rowIndex + 1, 0, subFieldState);
      }

      const newState = {
        ...remainingFlattenedState,
        [path]: {
          ...(state[path] || {}),
          value: unflattenedRows.length,
          disableFormData: true,
        },
        ...(flatten({ [path]: unflattenedRows }, { filters: flattenFilters })),
      };

      return newState;
    }

    case 'DUPLICATE_ROW': {
      const {
        rowIndex, path,
      } = action;

      const { unflattenedRows, remainingFlattenedState } = unflattenRowsFromState(state, path);

      const duplicate = deepCopyObject(unflattenedRows[rowIndex]);
      if (duplicate.id) delete duplicate.id;

      // If there are subfields
      if (Object.keys(duplicate).length > 0) {
        // Add new object containing subfield names to unflattenedRows array
        unflattenedRows.splice(rowIndex + 1, 0, duplicate);
      }

      const newState = {
        ...remainingFlattenedState,
        [path]: {
          ...(state[path] || {}),
          value: unflattenedRows.length,
          disableFormData: true,
        },
        ...(flatten({ [path]: unflattenedRows }, { filters: flattenFilters })),
      };

      return newState;
    }

    case 'MOVE_ROW': {
      const { moveFromIndex, moveToIndex, path } = action;
      const { unflattenedRows, remainingFlattenedState } = unflattenRowsFromState(state, path);

      // copy the row to move
      const copyOfMovingRow = unflattenedRows[moveFromIndex];
      // delete the row by index
      unflattenedRows.splice(moveFromIndex, 1);
      // insert row copyOfMovingRow back in
      unflattenedRows.splice(moveToIndex, 0, copyOfMovingRow);

      const newState = {
        ...remainingFlattenedState,
        ...(flatten({ [path]: unflattenedRows }, { filters: flattenFilters })),
      };

      return newState;
    }

    case 'MODIFY_CONDITION': {
      const { path, result } = action;

      return Object.entries(state).reduce((newState, [fieldPath, field]) => {
        if (fieldPath === path || fieldPath.indexOf(`${path}.`) === 0) {
          let passesCondition = result;

          // If a condition is being set to true,
          // Set all conditions to true
          // Besides those who still fail their own conditions

          if (passesCondition && field.condition) {
            passesCondition = field.condition(reduceFieldsToValues(state), getSiblingData(state, path));
          }

          return {
            ...newState,
            [fieldPath]: {
              ...field,
              passesCondition,
            },
          };
        }

        return {
          ...newState,
          [fieldPath]: {
            ...field,
          },
        };
      }, {});
    }

    case 'UPDATE': {
      const newField = Object.entries(action).reduce((field, [key, value]) => {
        if (['value', 'valid', 'errorMessage', 'disableFormData', 'initialValue', 'validate', 'condition', 'passesCondition'].includes(key)) {
          return {
            ...field,
            [key]: value,
          };
        }

        return field;
      }, state[action.path] || {} as Field);

      return {
        ...state,
        [action.path]: newField,
      };
    }

    default: {
      return state;
    }
  }
}

export default fieldReducer;
